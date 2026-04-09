jest.mock('../database', () => ({ getDb: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getDb } = require('../database');
const advertiserRoutes = require('../routes/advertiserRoutes');
const supportRoutes = require('../routes/supportRoutes');

function buildApp(router, mount = '/') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: 'user-1' };
    next();
  });
  app.use(mount, router);
  return app;
}

describe('advertiserRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns authenticated advertiser record', async () => {
    const findOne = jest.fn().mockResolvedValue({ _id: 'advertiser-1', userId: 'user-1' });
    getDb.mockReturnValue({ collection: jest.fn(() => ({ findOne })) });

    const res = await request(buildApp(advertiserRoutes)).get('/me').expect(200);

    expect(res.body).toEqual({
      message: 'success',
      data: { _id: 'advertiser-1', userId: 'user-1' },
    });
    expect(findOne).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  test('returns 404 when advertiser record does not exist', async () => {
    getDb.mockReturnValue({ collection: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(null) })) });

    const res = await request(buildApp(advertiserRoutes)).get('/me').expect(404);

    expect(res.body.error).toBe('Advertiser not found');
  });
});

describe('supportRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('requires a support message', async () => {
    const res = await request(buildApp(supportRoutes)).post('/tickets').send({}).expect(400);

    expect(res.body.error).toBe('message is required.');
  });

  test('creates support ticket with consent snapshot and safe defaults', async () => {
    const insertedId = { toHexString: () => 'ticket-1' };
    const insertOne = jest.fn().mockResolvedValue({ insertedId });
    const findOne = jest.fn()
      .mockResolvedValueOnce({ consentVersion: 'v1', accepted: true, acceptedAt: new Date('2026-04-01T00:00:00Z') })
      .mockResolvedValueOnce(null);
    const collection = jest.fn((name) => {
      if (name === 'user_consents') return { findOne };
      if (name === 'support_tickets') return { insertOne };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    const res = await request(buildApp(supportRoutes)).post('/tickets').send({
      ticketType: 'complaint',
      category: 'listing',
      message: 'A'.repeat(2100),
      targetKind: 'playground',
      targetId: 'place-1',
      screenshotUrl: 'https://example.com/screen.jpg',
    }).expect(201);

    expect(res.body).toEqual({ message: 'success', id: 'ticket-1' });
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      ticketType: 'complaint',
      category: 'listing',
      message: 'A'.repeat(2000),
      status: 'NEEDS_ADMIN_REVIEW',
      adultTermsConsentVersion: 'v1',
      adultTermsAccepted: true,
      locationServicesConsentVersion: null,
      locationServicesAccepted: false,
      createdAt: new Date('2026-04-09T12:00:00Z'),
      updatedAt: new Date('2026-04-09T12:00:00Z'),
    }));
  });

  test('normalizes unknown ticket types to other', async () => {
    const insertedId = { toHexString: () => 'ticket-2' };
    const insertOne = jest.fn().mockResolvedValue({ insertedId });
    const collection = jest.fn((name) => {
      if (name === 'user_consents') return { findOne: jest.fn().mockResolvedValue(null) };
      if (name === 'support_tickets') return { insertOne };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await request(buildApp(supportRoutes)).post('/tickets').send({
      ticketType: 'weird',
      message: 'Need help',
    }).expect(201);

    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ ticketType: 'other' }));
  });
});
