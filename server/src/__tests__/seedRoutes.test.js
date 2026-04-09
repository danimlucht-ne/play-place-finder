jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/authService', () => ({
  verifyAdminToken: jest.fn((req, _res, next) => {
    req.user = { uid: 'admin-1' };
    next();
  }),
}));
jest.mock('../services/seedOrchestratorService', () => ({ handleHybridSearch: jest.fn() }));
jest.mock('../services/photoUploadService', () => ({
  initPhotoUpload: jest.fn(),
  processPhoto: jest.fn(),
}));
jest.mock('../utils/helpers', () => ({
  getConsentSnapshot: jest.fn(),
  transformPlayground: jest.fn((p) => ({ id: String(p._id), name: p.name })),
}));
jest.mock('../services/notificationService', () => ({ sendAdminNotificationEmail: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getDb } = require('../database');
const seedOrchestratorService = require('../services/seedOrchestratorService');
const { initPhotoUpload, processPhoto } = require('../services/photoUploadService');
const { getConsentSnapshot } = require('../utils/helpers');
const { sendAdminNotificationEmail } = require('../services/notificationService');
const seedRoutes = require('../routes/seedRoutes');

function buildApp(uid = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid };
    next();
  });
  app.use('/', seedRoutes);
  return app;
}

function makeCursor(rows) {
  return {
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

describe('seedRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConsentSnapshot.mockResolvedValue({ adultTermsAccepted: true });
  });

  test('hybrid search requires coordinates and marks favorites for authenticated users', async () => {
    const missingReq = { body: { lat: 41.2 }, user: { uid: 'user-1' } };
    const missingRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await seedRoutes.hybridSearchHandler(missingReq, missingRes);

    expect(missingRes.status).toHaveBeenCalledWith(400);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Latitude and Longitude are required.' });

    seedOrchestratorService.handleHybridSearch.mockResolvedValue({
      places: [
        { _id: 'place-1', name: 'Favorite Park' },
        { _id: 'place-2', name: 'Other Park' },
      ],
    });
    getDb.mockReturnValue(makeDb({
      favorites: { find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([{ placeId: 'place-1' }]) }) },
    }));

    const req = { body: { lat: 41.25, lng: -96.01 }, user: { uid: 'user-1' } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await seedRoutes.hybridSearchHandler(req, res);

    expect(seedOrchestratorService.handleHybridSearch).toHaveBeenCalledWith(41.25, -96.01, 'user-1');
    expect(res.json).toHaveBeenCalledWith({
      places: [
        { id: 'place-1', name: 'Favorite Park', isFavorited: true },
        { id: 'place-2', name: 'Other Park', isFavorited: false },
      ],
    });
  });

  test('photo upload routes pass consent and user context to upload services', async () => {
    initPhotoUpload.mockResolvedValue({ uploadUrl: 'https://upload.example' });
    processPhoto.mockResolvedValue({ status: 'processed' });

    const init = await request(buildApp()).post('/photos/init').send({
      filename: 'park.jpg',
      contentType: 'image/jpeg',
    }).expect(200);
    const processed = await request(buildApp()).post('/photos/process').send({
      photoRecordId: 'photo-1',
      playgroundId: 'place-1',
    }).expect(200);

    expect(initPhotoUpload).toHaveBeenCalledWith('park.jpg', 'image/jpeg', { adultTermsAccepted: true });
    expect(processPhoto).toHaveBeenCalledWith('photo-1', 'place-1', 'user-1');
    expect(init.body).toEqual({ uploadUrl: 'https://upload.example' });
    expect(processed.body).toEqual({ status: 'processed' });
  });

  test('admin can create businesses with parsed point coordinates', async () => {
    const insertOne = jest.fn();
    getDb.mockReturnValue(makeDb({ businesses: { insertOne } }));

    const res = await request(buildApp()).post('/businesses').send({
      name: 'Snack Shack',
      category: 'Food',
      description: 'Near the park',
      websiteUrl: 'https://snacks.example',
      latitude: '41.25',
      longitude: '-96.01',
    }).expect(201);

    expect(insertOne).toHaveBeenCalledWith({
      name: 'Snack Shack',
      category: 'Food',
      description: 'Near the park',
      websiteUrl: 'https://snacks.example',
      location: { type: 'Point', coordinates: [-96.01, 41.25] },
    });
    expect(res.body).toEqual({ message: 'success' });
  });

  test('nearby sponsors require coordinates and use contextual category filters only', async () => {
    await request(buildApp()).get('/sponsors/nearby').expect(400);

    const sponsors = [{ name: 'Snack Shack', category: 'Food' }];
    const find = jest.fn().mockReturnValue(makeCursor(sponsors));
    getDb.mockReturnValue(makeDb({ businesses: { find } }));

    const res = await request(buildApp()).get('/sponsors/nearby?lat=41.25&lng=-96.01&category=Food').expect(200);

    expect(find).toHaveBeenCalledWith({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [-96.01, 41.25] },
          $maxDistance: 3000,
        },
      },
      category: 'Food',
    });
    expect(res.body).toEqual({ message: 'success', data: sponsors });
  });

  test('advertiser intake validates required fields and rejects duplicate contact emails', async () => {
    await request(buildApp()).post('/advertisers').send({ businessName: 'Tiny Gym' }).expect(400);

    getDb.mockReturnValue(makeDb({
      advertiser_intakes: { findOne: jest.fn().mockResolvedValue({ contactEmail: 'owner@example.com' }) },
    }));

    const res = await request(buildApp()).post('/advertisers').send({
      businessName: 'Tiny Gym',
      contactEmail: 'owner@example.com',
      category: 'Play',
      city: 'Omaha NE',
    }).expect(409);

    expect(res.body).toEqual({ error: 'An intake with this contact email already exists.' });
  });

  test('advertiser intake stores normalized region, truncates description, and notifies admin', async () => {
    const insertOne = jest.fn();
    getDb.mockReturnValue(makeDb({
      advertiser_intakes: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne,
      },
    }));

    const res = await request(buildApp()).post('/advertisers').send({
      businessName: 'Tiny Gym',
      contactEmail: 'owner@example.com',
      category: 'Play',
      city: 'Omaha NE',
      websiteUrl: 'https://tiny.example',
      description: 'A'.repeat(350),
    }).expect(201);

    expect(insertOne).toHaveBeenCalledWith({
      businessName: 'Tiny Gym',
      contactEmail: 'owner@example.com',
      category: 'Play',
      city: 'Omaha NE',
      targetRegionKey: 'omaha_ne',
      websiteUrl: 'https://tiny.example',
      description: 'A'.repeat(300),
      status: 'pending',
      createdAt: expect.any(Date),
    });
    expect(sendAdminNotificationEmail).toHaveBeenCalledWith(
      'New Advertiser Intake: Tiny Gym',
      expect.stringContaining('owner@example.com'),
      expect.stringContaining('<b>Tiny Gym</b>'),
    );
    expect(res.body).toEqual({ message: 'success' });
  });
});
