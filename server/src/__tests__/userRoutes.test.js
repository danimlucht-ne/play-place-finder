jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/contributionService', () => ({ getLeaderboard: jest.fn() }));
jest.mock('../services/storageService', () => ({
  publicBucket: { file: jest.fn(() => ({ delete: jest.fn().mockResolvedValue() })) },
}));
jest.mock('../utils/helpers', () => ({ transformPlayground: jest.fn((p) => ({ id: String(p._id), name: p.name })) }));

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const contributionService = require('../services/contributionService');
const { publicBucket } = require('../services/storageService');
const userRoutes = require('../routes/userRoutes');

function buildApp(uid = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = uid ? { uid } : null;
    next();
  });
  app.use('/', userRoutes);
  return app;
}

function makeCursor(rows) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    project: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(rows),
  };
}

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

describe('userRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('records consent acceptance and reports required consent versions', async () => {
    const insertOne = jest.fn();
    const findOne = jest.fn()
      .mockResolvedValueOnce({ accepted: true, consentVersion: 2 })
      .mockResolvedValueOnce({ accepted: false, consentVersion: 1 });
    getDb.mockReturnValue(makeDb({ user_consents: { insertOne, findOne } }));
    process.env.ADULT_TERMS_CONSENT_VERSION = '2';
    process.env.LOCATION_SERVICES_CONSENT_VERSION = '2';

    await request(buildApp()).post('/consents').send({
      consentType: 'adult_terms',
      consentVersion: 2,
      accepted: true,
      appVersion: '1.0.0',
      deviceType: 'android',
    }).expect(200);
    const required = await request(buildApp()).get('/consents/required').expect(200);

    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      consentType: 'adult_terms',
      consentVersion: 2,
      accepted: true,
      appVersion: '1.0.0',
      deviceType: 'android',
    }));
    expect(required.body.data.adult_terms.required).toBe(false);
    expect(required.body.data.location_services.required).toBe(true);
  });

  test('toggles favorites and keeps playground favorite counts in sync', async () => {
    const placeId = new ObjectId().toHexString();
    const findOne = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: 'user-1', placeId });
    const insertOne = jest.fn();
    const deleteOne = jest.fn();
    const updateOne = jest.fn();
    getDb.mockReturnValue(makeDb({
      favorites: { findOne, insertOne, deleteOne },
      playgrounds: { updateOne },
    }));
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const added = await request(buildApp()).post('/favorites').send({ placeId }).expect(201);
    const removed = await request(buildApp()).post('/favorites').send({ placeId }).expect(200);

    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', placeId }));
    expect(deleteOne).toHaveBeenCalledWith({ userId: 'user-1', placeId });
    expect(updateOne).toHaveBeenNthCalledWith(1, { _id: new ObjectId(placeId) }, { $inc: { favoriteCount: 1 } });
    expect(updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: new ObjectId(placeId), favoriteCount: { $gt: 0 } },
      { $inc: { favoriteCount: -1 } },
    );
    expect(added.body).toEqual({ message: 'added' });
    expect(removed.body).toEqual({ message: 'removed' });
    console.log.mockRestore();
  });

  test('returns favorite ids and enforces user ownership for full favorite lists', async () => {
    const placeId = new ObjectId();
    const favoriteRows = [{ placeId: placeId.toHexString() }];
    getDb.mockReturnValue(makeDb({
      favorites: { find: jest.fn().mockReturnValue(makeCursor(favoriteRows)) },
      playgrounds: { find: jest.fn().mockReturnValue(makeCursor([{ _id: placeId, name: 'Park' }])) },
    }));

    await request(buildApp()).get('/favorites/other-user').expect(403);
    const ids = await request(buildApp()).get('/favorites/me/ids').expect(200);
    const full = await request(buildApp()).get('/favorites/user-1').expect(200);

    expect(ids.body).toEqual({ message: 'success', data: [placeId.toHexString()] });
    expect(full.body).toEqual({ message: 'success', data: [{ id: placeId.toHexString(), name: 'Park' }] });
  });

  test('creates, lists, edits, and deletes playlists', async () => {
    const listId = new ObjectId();
    const insertOne = jest.fn().mockResolvedValue({ insertedId: listId });
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    getDb.mockReturnValue(makeDb({
      playlists: {
        insertOne,
        find: jest.fn().mockReturnValue(makeCursor([{ _id: listId, name: 'Favorites', color: '#00ced1', placeIds: ['p1'] }])),
        updateOne,
        deleteOne,
      },
    }));

    await request(buildApp()).post('/lists').send({ name: '' }).expect(400);
    const created = await request(buildApp()).post('/lists').send({ name: 'Favorites', color: '#00ced1' }).expect(201);
    const lists = await request(buildApp()).get('/lists').expect(200);
    await request(buildApp()).put(`/lists/${listId.toHexString()}/rename`).send({ name: 'Weekend' }).expect(200);
    await request(buildApp()).put(`/lists/${listId.toHexString()}/add`).send({ placeId: 'p2' }).expect(200);
    await request(buildApp()).put(`/lists/${listId.toHexString()}/remove`).send({ placeId: 'p1' }).expect(200);
    await request(buildApp()).delete(`/lists/${listId.toHexString()}`).expect(200);

    expect(created.body).toEqual({ message: 'success', id: listId.toHexString() });
    expect(lists.body.data).toEqual([{ id: listId.toHexString(), name: 'Favorites', color: '#00ced1', placeCount: 1 }]);
    expect(updateOne).toHaveBeenCalledWith({ _id: listId, userId: 'user-1' }, { $set: { name: 'Weekend' } });
    expect(updateOne).toHaveBeenCalledWith({ _id: listId, userId: 'user-1' }, { $addToSet: { placeIds: 'p2' } });
    expect(updateOne).toHaveBeenCalledWith({ _id: listId, userId: 'user-1' }, { $pull: { placeIds: 'p1' } });
    expect(deleteOne).toHaveBeenCalledWith({ _id: listId, userId: 'user-1' });
  });

  test('returns profile, contributor rank, and leaderboard data', async () => {
    const user = { _id: 'user-1', email: 'u@example.com', role: 'admin', score: 20, level: 'Guide', regionKey: 'omaha-ne' };
    getDb.mockReturnValue(makeDb({
      users: {
        findOne: jest.fn().mockResolvedValue(user),
        countDocuments: jest.fn().mockResolvedValue(4),
      },
    }));
    contributionService.getLeaderboard.mockResolvedValue([{ userId: 'user-1', score: 20 }]);

    const me = await request(buildApp()).get('/users/me').expect(200);
    const profile = await request(buildApp()).get('/users/me/contributor-profile').expect(200);
    const leaderboard = await request(buildApp()).get('/leaderboard?regionKey=omaha-ne&limit=5').expect(200);

    expect(me.body.data).toEqual({
      _id: 'user-1',
      email: 'u@example.com',
      role: 'admin',
      score: 20,
      level: 'Guide',
      adFree: false,
    });
    expect(profile.body.data.rank).toBe(5);
    expect(contributionService.getLeaderboard).toHaveBeenCalledWith('omaha-ne', 5);
    expect(leaderboard.body.data).toEqual([{ userId: 'user-1', score: 20 }]);
  });

  test('reads and marks notifications', async () => {
    const notificationId = new ObjectId();
    const updateMany = jest.fn();
    getDb.mockReturnValue(makeDb({
      user_notifications: {
        find: jest.fn().mockReturnValue(makeCursor([{ _id: notificationId, read: false }])),
        updateMany,
      },
    }));

    const notifications = await request(buildApp()).get('/users/me/notifications').expect(200);
    await request(buildApp()).post('/users/me/notifications/mark-read').send({ ids: [notificationId.toHexString()] }).expect(200);
    await request(buildApp()).post('/users/me/notifications/mark-read').send({}).expect(200);

    expect(notifications.body.data).toEqual([{ _id: notificationId.toHexString(), read: false }]);
    expect(updateMany).toHaveBeenNthCalledWith(1, { userId: 'user-1', _id: { $in: [notificationId] } }, { $set: { read: true } });
    expect(updateMany).toHaveBeenNthCalledWith(2, { userId: 'user-1' }, { $set: { read: true } });
  });

  test('returns user submissions from moderation and support tickets', async () => {
    const photoId = new ObjectId();
    const moderationId = new ObjectId();
    const supportId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      photo_uploads: { find: jest.fn().mockReturnValue(makeCursor([{ _id: photoId }])) },
      moderation_queue: {
        find: jest.fn().mockReturnValue(makeCursor([{
          _id: moderationId,
          submissionType: 'PHOTO',
          status: 'APPROVED',
          playgroundName: 'Park',
          playgroundId: 'place-1',
          previewUrl: 'https://example.com/p.jpg',
          reason: ' Looks good ',
          createdAt: new Date('2026-04-09T12:00:00Z'),
        }])),
      },
      support_tickets: {
        find: jest.fn().mockReturnValue(makeCursor([{
          _id: supportId,
          ticketType: 'suggestion',
          status: 'NEEDS_ADMIN_REVIEW',
          targetPlaygroundSummary: { name: 'Neighborhood Park' },
          targetId: 'pg-2',
          message: 'Add toddler swing',
          createdAt: new Date('2026-04-10T12:00:00Z'),
        }])),
      },
    }));

    const res = await request(buildApp()).get('/users/me/submissions?limit=200').expect(200);

    expect(res.body.data).toEqual([
      {
        id: supportId.toHexString(),
        source: 'SUPPORT',
        submissionType: 'SUGGESTION',
        status: 'NEEDS_ADMIN_REVIEW',
        playgroundName: 'Neighborhood Park',
        playgroundId: 'pg-2',
        previewUrl: null,
        reason: 'Add toddler swing',
        reviewedAt: null,
        createdAt: '2026-04-10T12:00:00.000Z',
      },
      {
        id: moderationId.toHexString(),
        source: 'MODERATION',
        submissionType: 'PHOTO',
        status: 'APPROVED',
        playgroundName: 'Park',
        playgroundId: 'place-1',
        previewUrl: 'https://example.com/p.jpg',
        reason: 'Looks good',
        reviewedAt: null,
        createdAt: '2026-04-09T12:00:00.000Z',
      },
    ]);
  });

  test('clears contributor display name with null body or clearDisplayName flag', async () => {
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
    getDb.mockReturnValue(makeDb({ users: { updateOne } }));

    const cleared = await request(buildApp()).put('/users/me/display-name').send({ displayName: null }).expect(200);
    expect(cleared.body).toEqual({ message: 'success', displayName: null });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'user-1' },
      expect.objectContaining({
        $unset: { displayName: '' },
        $set: expect.objectContaining({ updatedAt: expect.any(Date) }),
      }),
      { upsert: true },
    );

    updateOne.mockClear();
    await request(buildApp()).put('/users/me/display-name').send({ clearDisplayName: true }).expect(200);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  test('saves safe contributor display names and rejects obvious unsafe ones without model dependencies', async () => {
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
    getDb.mockReturnValue(makeDb({ users: { updateOne } }));

    const saved = await request(buildApp()).put('/users/me/display-name').send({ displayName: 'Play Scout' }).expect(200);
    expect(saved.body).toEqual({ message: 'success', displayName: 'Play Scout' });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'user-1' },
      { $set: { displayName: 'Play Scout', updatedAt: expect.any(Date) } },
      { upsert: true },
    );

    const blocked = await request(buildApp()).put('/users/me/display-name').send({ displayName: 'text me 402-555-1212' }).expect(400);
    expect(blocked.body).toEqual({ error: 'Display name is not appropriate.' });
  });

  test('delete account anonymizes user content and removes stored photo objects', async () => {
    const updateMany = jest.fn();
    const deleteMany = jest.fn();
    const deleteOne = jest.fn();
    const photoId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      favorites: { deleteMany },
      playlists: { deleteMany },
      crowd_reports: { updateMany },
      issue_reports: { updateMany },
      location_verifications: { updateMany },
      support_tickets: { updateMany },
      photo_uploads: {
        find: jest.fn().mockReturnValue(makeCursor([{
          _id: photoId,
          finalUrl: 'https://cdn.example/p.jpg',
          finalObjectPath: 'photos/p.jpg',
        }])),
        updateMany,
      },
      playgrounds: { updateMany },
      moderation_queue: { updateMany },
      contribution_log: { deleteMany },
      users: { deleteOne },
      user_consents: { updateMany },
    }));

    await request(buildApp()).delete('/account').expect(200);

    expect(publicBucket.file).toHaveBeenCalledWith('photos/p.jpg');
    expect(deleteMany).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(deleteOne).toHaveBeenCalledWith({ _id: 'user-1' });
    expect(updateMany).toHaveBeenCalled();
  });
});
