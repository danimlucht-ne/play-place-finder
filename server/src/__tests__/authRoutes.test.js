const mockAuth = {
  createUser: jest.fn(),
  deleteUser: jest.fn(),
  generateEmailVerificationLink: jest.fn(),
  createCustomToken: jest.fn(),
  generatePasswordResetLink: jest.fn(),
  verifyIdToken: jest.fn(),
};

jest.mock('firebase-admin', () => ({ auth: jest.fn(() => mockAuth) }));
jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendEmail: jest.fn() }));

const express = require('express');
const request = require('supertest');
const axios = require('axios');
const { getDb } = require('../database');
const { sendEmail } = require('../services/notificationService');
const authRoutes = require('../routes/authRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', authRoutes);
  return app;
}

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

describe('authRoutes', () => {
  const originalApiKey = process.env.FIREBASE_WEB_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
    process.env.FIREBASE_WEB_API_KEY = 'firebase-key';
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    console.error.mockRestore();
    console.warn.mockRestore();
    if (originalApiKey === undefined) {
      delete process.env.FIREBASE_WEB_API_KEY;
    } else {
      process.env.FIREBASE_WEB_API_KEY = originalApiKey;
    }
  });

  test('register requires email and a strong password', async () => {
    await request(buildApp()).post('/register').send({}).expect(400);

    const weak = await request(buildApp()).post('/register').send({
      email: 'new@test.invalid',
      password: 'short',
    }).expect(400);

    expect(weak.body.error).toMatch(/at least/i);
    expect(mockAuth.createUser).not.toHaveBeenCalled();
  });

  test('register creates Firebase and DB users, sends verification, and exchanges a custom token', async () => {
    const updateOne = jest.fn();
    getDb.mockReturnValue(makeDb({ users: { updateOne } }));
    mockAuth.createUser.mockResolvedValue({ uid: 'uid-1' });
    mockAuth.generateEmailVerificationLink.mockResolvedValue('https://verify.example/link');
    mockAuth.createCustomToken.mockResolvedValue('custom-token');
    axios.post.mockResolvedValue({ data: { idToken: 'id-token' } });

    const res = await request(buildApp()).post('/register').send({
      email: 'new@test.invalid',
      password: 'StrongPass1!',
    }).expect(201);

    expect(mockAuth.createUser).toHaveBeenCalledWith({
      email: 'new@test.invalid',
      password: 'StrongPass1!',
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'uid-1' },
      {
        $setOnInsert: {
          _id: 'uid-1',
          email: 'new@test.invalid',
          createdAt: new Date('2026-04-09T12:00:00Z'),
          score: 0,
          level: 'Newcomer',
          contributions: { total: 0, newPlaygrounds: 0, edits: 0, photos: 0, reports: 0 },
        },
      },
      { upsert: true },
    );
    expect(sendEmail).toHaveBeenCalledWith(
      'new@test.invalid',
      'Confirm your email \u2014 Play Place Finder',
      expect.stringContaining('https://verify.example/link'),
      expect.stringContaining('https://verify.example/link'),
    );
    expect(axios.post).toHaveBeenCalledWith(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=firebase-key',
      { token: 'custom-token', returnSecureToken: true },
    );
    expect(res.body).toEqual({ message: 'success', token: 'id-token', userId: 'uid-1' });
  });

  test('register maps duplicate Firebase emails to conflict', async () => {
    mockAuth.createUser.mockRejectedValue({ code: 'auth/email-already-exists', message: 'exists' });

    const res = await request(buildApp()).post('/register').send({
      email: 'taken@test.invalid',
      password: 'StrongPass1!',
    }).expect(409);

    expect(res.body).toEqual({ error: 'An account with this email already exists.' });
    expect(mockAuth.deleteUser).not.toHaveBeenCalled();
  });

  test('register rolls back Firebase and DB user if token exchange fails after createUser', async () => {
    const updateOne = jest.fn();
    const deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    getDb.mockReturnValue(makeDb({ users: { updateOne, deleteOne } }));
    mockAuth.createUser.mockResolvedValue({ uid: 'uid-rollback' });
    mockAuth.generateEmailVerificationLink.mockResolvedValue('https://verify.example/link');
    mockAuth.createCustomToken.mockResolvedValue('custom-token');
    mockAuth.deleteUser.mockResolvedValue(undefined);
    axios.post.mockRejectedValue(new Error('Identity Toolkit exchange failed'));

    const res = await request(buildApp()).post('/register').send({
      email: 'rollback@test.invalid',
      password: 'StrongPass1!',
    }).expect(500);

    expect(res.body.error).toMatch(/Identity Toolkit exchange failed/);
    expect(deleteOne).toHaveBeenCalledWith({ _id: 'uid-rollback' });
    expect(mockAuth.deleteUser).toHaveBeenCalledWith('uid-rollback');
  });

  test('google-signin requires idToken, verifies with Firebase Admin, upserts user', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    const findOne = jest.fn().mockResolvedValue({ _id: 'google-uid' });
    getDb.mockReturnValue(makeDb({ users: { updateOne, findOne } }));
    mockAuth.verifyIdToken.mockResolvedValue({ uid: 'google-uid', email: 'g@test.invalid' });

    await request(buildApp()).post('/google-signin').send({}).expect(400);

    const res = await request(buildApp()).post('/google-signin').send({ idToken: 'firebase-id-jwt' }).expect(200);

    expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('firebase-id-jwt');
    expect(res.body).toEqual({ message: 'success', token: 'firebase-id-jwt', userId: 'google-uid' });
  });

  test('google-signin rejects invalid tokens', async () => {
    getDb.mockReturnValue(makeDb({ users: { updateOne: jest.fn(), findOne: jest.fn() } }));
    mockAuth.verifyIdToken.mockRejectedValue(new Error('invalid token'));

    const res = await request(buildApp()).post('/google-signin').send({ idToken: 'bad' }).expect(401);
    expect(res.body.error).toMatch(/Invalid or expired/i);
  });

  test('login requires credentials and maps invalid Firebase credentials to 401', async () => {
    await request(buildApp()).post('/login').send({}).expect(400);

    axios.post.mockRejectedValue({ response: { data: { error: { message: 'INVALID_LOGIN_CREDENTIALS' } } } });
    const res = await request(buildApp()).post('/login').send({
      email: 'user@test.invalid',
      password: 'wrong',
    }).expect(401);

    expect(res.body).toEqual({ error: 'Invalid email or password.' });
  });

  test('login upserts user and blocks banned or temporarily blocked accounts', async () => {
    const updateOne = jest.fn();
    const findOne = jest.fn()
      .mockResolvedValueOnce({ _id: 'uid-1', bannedAt: new Date('2026-04-01T00:00:00Z'), bannedReason: 'Spam' })
      .mockResolvedValueOnce({ _id: 'uid-1', blockedAt: new Date('2026-04-01T00:00:00Z'), blockedReason: 'Review' })
      .mockResolvedValueOnce({ _id: 'uid-1' });
    getDb.mockReturnValue(makeDb({ users: { updateOne, findOne } }));
    axios.post.mockResolvedValue({ data: { localId: 'uid-1', idToken: 'id-token' } });

    const banned = await request(buildApp()).post('/login').send({
      email: 'user@test.invalid',
      password: 'StrongPass1!',
    }).expect(403);
    const blocked = await request(buildApp()).post('/login').send({
      email: 'user@test.invalid',
      password: 'StrongPass1!',
    }).expect(403);
    const ok = await request(buildApp()).post('/login').send({
      email: 'user@test.invalid',
      password: 'StrongPass1!',
    }).expect(200);

    expect(banned.body.error).toContain('permanently banned');
    expect(blocked.body.error).toContain('temporarily blocked');
    expect(ok.body).toEqual({ message: 'success', token: 'id-token', userId: 'uid-1' });
    expect(updateOne).toHaveBeenCalledTimes(3);
  });

  test('resend verification sends a verification email', async () => {
    mockAuth.generateEmailVerificationLink.mockResolvedValue('https://verify.example/link');

    const res = await request(buildApp()).post('/resend-verification').send({
      email: 'user@test.invalid',
    }).expect(200);

    expect(sendEmail).toHaveBeenCalledWith(
      'user@test.invalid',
      'Confirm your email \u2014 Play Place Finder',
      expect.stringContaining('https://verify.example/link'),
      expect.stringContaining('https://verify.example/link'),
    );
    expect(res.body).toEqual({ message: 'Verification email sent.' });
  });

  test('reset password always returns the generic success message', async () => {
    mockAuth.generatePasswordResetLink.mockResolvedValueOnce('https://reset.example/link');
    const success = await request(buildApp()).post('/reset-password').send({
      email: 'user@test.invalid',
    }).expect(200);

    mockAuth.generatePasswordResetLink.mockRejectedValueOnce(new Error('not found'));
    const failure = await request(buildApp()).post('/reset-password').send({
      email: 'missing@test.invalid',
    }).expect(200);

    expect(success.body).toEqual({ message: 'If that email is registered, a reset link has been sent.' });
    expect(failure.body).toEqual({ message: 'If that email is registered, a reset link has been sent.' });
  });
});
