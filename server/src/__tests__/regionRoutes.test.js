jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/seedOrchestratorService', () => ({
  geocodeTextQuery: jest.fn(),
  geocodeLatLng: jest.fn(),
  normalizeRegionKey: jest.fn((city, state) => `${city}-${state}`.toLowerCase().replace(/\s+/g, '-')),
  handleHybridSearch: jest.fn(),
}));
jest.mock('../utils/helpers', () => ({ transformPlayground: jest.fn((p) => ({ id: String(p._id), name: p.name })) }));
jest.mock('../utils/playgroundIdFilter', () => ({ collectSubsumedPlaygroundIdsForRegion: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn() }));

const express = require('express');
const request = require('supertest');
const axios = require('axios');
const { getDb } = require('../database');
const seedOrchestratorService = require('../services/seedOrchestratorService');
const { collectSubsumedPlaygroundIdsForRegion } = require('../utils/playgroundIdFilter');
const regionRoutes = require('../routes/regionRoutes');

function buildApp(uid = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid };
    next();
  });
  app.use('/', regionRoutes);
  return app;
}

function makeFindCursor(rows) {
  return {
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
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

describe('regionRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('search validates body shape, query length, and coordinates', async () => {
    await request(buildApp()).post('/search').send(null).expect(400);
    await request(buildApp()).post('/search').send({ query: 'x'.repeat(101) }).expect(400);
    await request(buildApp()).post('/search').send({ lat: 99, lng: 0 }).expect(400);
  });

  test('search returns seeded region playgrounds merged with nearby results', async () => {
    seedOrchestratorService.geocodeTextQuery.mockResolvedValue({
      lat: 41.25,
      lng: -96.01,
      city: 'Omaha',
      state: 'NE',
      country: 'US',
    });
    const byRegion = [{ _id: 'region-1', name: 'Region Park' }];
    const near = [
      { _id: 'region-1', name: 'Region Park duplicate' },
      { _id: 'near-1', name: 'Nearby Park' },
    ];
    getDb.mockReturnValue(makeDb({
      seeded_regions: {
        findOne: jest.fn().mockResolvedValue({
          regionKey: 'omaha-ne',
          city: 'Omaha',
          state: 'NE',
          center: { lat: 41.25, lng: -96.01 },
        }),
      },
      playgrounds: {
        find: jest.fn()
          .mockReturnValueOnce(makeFindCursor(byRegion))
          .mockReturnValueOnce(makeFindCursor(near)),
      },
    }));

    const res = await request(buildApp()).post('/search').send({ query: ' Omaha, NE ' }).expect(200);

    expect(seedOrchestratorService.handleHybridSearch).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      regionKey: 'omaha-ne',
      city: 'Omaha',
      state: 'NE',
      center: { lat: 41.25, lng: -96.01 },
      seeded: true,
      seedingTriggered: false,
      places: [
        { id: 'region-1', name: 'Region Park' },
        { id: 'near-1', name: 'Nearby Park' },
      ],
    });
  });

  test('coordinate search rejects non-US reverse geocodes', async () => {
    seedOrchestratorService.geocodeLatLng.mockResolvedValue({
      city: 'Winnipeg',
      state: 'MB',
      country: 'CA',
    });

    const res = await request(buildApp()).post('/search').send({ lat: 49.89, lng: -97.13 }).expect(400);

    expect(res.body).toEqual({ error: 'Play Place Finder is currently available in the United States only.' });
  });

  test('unseeded coordinate search returns nearby places without triggering duplicate hybrid seeding', async () => {
    seedOrchestratorService.geocodeLatLng.mockResolvedValue({
      city: 'Omaha',
      state: 'NE',
      country: 'US',
    });
    getDb.mockReturnValue(makeDb({
      seeded_regions: { findOne: jest.fn().mockResolvedValue(null) },
      playgrounds: { find: jest.fn().mockReturnValue(makeFindCursor([{ _id: 'near-1', name: 'Nearby Park' }])) },
    }));

    const res = await request(buildApp()).post('/search').send({ lat: 41.25, lng: -96.01 }).expect(200);

    expect(seedOrchestratorService.handleHybridSearch).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      regionKey: 'omaha-ne',
      seeded: false,
      seedingTriggered: false,
      places: [{ id: 'near-1', name: 'Nearby Park' }],
    });
  });

  test('unseeded text search triggers hybrid seeding and merges nearby results', async () => {
    seedOrchestratorService.geocodeTextQuery.mockResolvedValue({
      lat: 41.25,
      lng: -96.01,
      city: 'Omaha',
      state: 'NE',
      country: 'US',
    });
    seedOrchestratorService.handleHybridSearch.mockResolvedValue({
      places: [{ _id: 'seeded-1', name: 'Seeded Park' }],
    });
    getDb.mockReturnValue(makeDb({
      seeded_regions: { findOne: jest.fn().mockResolvedValue(null) },
      playgrounds: { find: jest.fn().mockReturnValue(makeFindCursor([{ _id: 'near-1', name: 'Nearby Park' }])) },
    }));

    const res = await request(buildApp()).post('/search').send({ query: 'Omaha' }).expect(200);

    expect(seedOrchestratorService.handleHybridSearch).toHaveBeenCalledWith(41.25, -96.01, 'user-1');
    expect(res.body).toMatchObject({
      seeded: false,
      seedingTriggered: true,
      places: [
        { id: 'near-1', name: 'Nearby Park' },
        { id: 'seeded-1', name: 'Seeded Park' },
      ],
    });
  });

  test('by-region requires regionKey and excludes subsumed playground ids', async () => {
    collectSubsumedPlaygroundIdsForRegion.mockResolvedValue(['old-1']);
    const find = jest.fn().mockReturnValue(makeFindCursor([{ _id: 'new-1', name: 'New Park' }]));
    const countDocuments = jest.fn().mockResolvedValue(1);
    getDb.mockReturnValue(makeDb({
      playgrounds: { find, countDocuments },
    }));

    await request(buildApp()).get('/by-region').expect(400);
    const res = await request(buildApp()).get('/by-region?regionKey=omaha-ne&limit=500&skip=-2').expect(200);

    expect(find).toHaveBeenCalledWith({
      archivedAt: { $exists: false },
      status: { $nin: ['closed', 'archived'] },
      $or: [{ regionKey: 'omaha-ne' }, { coveredRegionKeys: 'omaha-ne' }],
      _id: { $nin: ['old-1'] },
    });
    expect(countDocuments).toHaveBeenCalledWith({
      archivedAt: { $exists: false },
      status: { $nin: ['closed', 'archived'] },
      $or: [{ regionKey: 'omaha-ne' }, { coveredRegionKeys: 'omaha-ne' }],
      _id: { $nin: ['old-1'] },
    });
    expect(res.body).toEqual({
      message: 'success',
      data: [{ id: 'new-1', name: 'New Park' }],
      total: 1,
    });
  });

  test('autocomplete maps Google predictions and safely returns empty lists on short input or errors', async () => {
    await request(buildApp()).get('/autocomplete?input=o').expect(200, { predictions: [] });

    axios.get.mockResolvedValueOnce({
      data: { predictions: [{ description: 'Omaha, NE, USA', place_id: 'place-google' }] },
    });
    const ok = await request(buildApp()).get('/autocomplete?input=oma').expect(200);
    expect(ok.body).toEqual({ predictions: [{ description: 'Omaha, NE, USA', placeId: 'place-google' }] });

    axios.get.mockRejectedValueOnce(new Error('maps down'));
    await request(buildApp()).get('/autocomplete?input=oma').expect(200, { predictions: [] });
  });
});
