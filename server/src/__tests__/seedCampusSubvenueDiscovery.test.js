jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../services/photoClassificationService', () => ({
  getGeminiSummary: jest.fn(),
  getGeminiLocationValidation: jest.fn(),
  getGeminiDescription: jest.fn(),
}));
jest.mock('../services/faceStickerMaskService', () => ({
  detectFaces: jest.fn(),
  applyStickerMasks: jest.fn(),
}));
jest.mock('../services/storageService', () => ({
  publicBucket: jest.fn(),
  uploadBufferToPublic: jest.fn(),
}));
jest.mock('../services/equipmentValidationService', () => ({
  validate: jest.fn(),
  shouldQueueForReview: jest.fn(),
  computePhotoScore: jest.fn(),
  rerankGallery: jest.fn(),
  deduplicateGallery: jest.fn(),
  computePhash: jest.fn(),
}));

const axios = require('axios');
const { getDb } = require('../database');
const { discoverCampusSubvenues, generateSearchGrid } = require('../services/seedOrchestratorService');

function cursor(rows) {
  return {
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(rows),
  };
}

describe('discoverCampusSubvenues', () => {
  let timeoutSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((cb) => {
      cb();
      return 0;
    });
  });

  afterEach(() => {
    timeoutSpy.mockRestore();
  });

  test('searches around campus anchors and upserts exhibit-style POIs', async () => {
    const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    const db = {
      collection: jest.fn((name) => {
        if (name === 'playgrounds') {
          return {
            find: jest.fn().mockReturnValue(cursor([{
              _id: 'zoo-main',
              name: "Omaha's Henry Doorly Zoo and Aquarium",
              regionKey: 'omaha-ne',
              types: ['zoo', 'tourist_attraction'],
              location: { type: 'Point', coordinates: [-95.9284, 41.2242] },
            }])),
            bulkWrite,
          };
        }
        if (name === 'archived_playgrounds') {
          return {
            find: jest.fn().mockReturnValue({
              project: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue([]),
            }),
          };
        }
        return {};
      }),
    };
    getDb.mockReturnValue(db);
    axios.get.mockResolvedValue({
      data: {
        status: 'OK',
        results: [{
          place_id: 'lied-jungle',
          name: 'Lied Jungle',
          types: ['establishment', 'point_of_interest'],
          vicinity: 'Omaha Zoo',
          geometry: { location: { lat: 41.2227, lng: -95.93 } },
        }],
      },
    });

    const result = await discoverCampusSubvenues('omaha-ne', {
      maxAnchors: 1,
      maxNearbyCalls: 2,
      radiusMeters: 1400,
    });

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get.mock.calls[0][0]).toContain('radius=1400');
    expect(axios.get.mock.calls[0][0]).toContain('keyword=exhibit');
    expect(bulkWrite.mock.calls[0][0][0].updateOne.update.$setOnInsert).toEqual(expect.objectContaining({
      _id: 'lied-jungle',
      name: 'Lied Jungle',
      regionKey: 'omaha-ne',
      status: 'active',
    }));
    expect(result).toEqual({
      anchorsScanned: 1,
      googleNearbyCalls: 2,
      candidatesScanned: 1,
      candidatesInserted: 1,
      placesSkipped: 0,
    });
  });
});


describe('generateSearchGrid', () => {
  test('returns 3×3 grid (9 points) for small metro with no viewport (legacy fallback)', () => {
    const points = generateSearchGrid(41.25, -96.01);
    expect(points).toHaveLength(9);
  });

  test('tiles a small geocode viewport (Omaha-sized) with a bounded number of cell centers', () => {
    const viewport = {
      northeast: { lat: 41.35, lng: -95.85 },
      southwest: { lat: 41.15, lng: -96.15 },
    };
    const points = generateSearchGrid(41.25, -96.01, { viewport });
    expect(points.length).toBeGreaterThanOrEqual(1);
    expect(points.length).toBeLessThanOrEqual(20);
    for (const p of points) {
      expect(p.lat).toBeGreaterThanOrEqual(41.15);
      expect(p.lat).toBeLessThanOrEqual(41.35);
      expect(p.lng).toBeGreaterThanOrEqual(-96.15);
      expect(p.lng).toBeLessThanOrEqual(-95.85);
    }
  });

  test('uses an adaptive grid for a medium geocode box (wider than a 3×3 around one point)', () => {
    const viewport = {
      northeast: { lat: 39.9, lng: -104.6 },
      southwest: { lat: 39.3, lng: -105.2 },
    };
    const points = generateSearchGrid(39.6, -104.9, { viewport });
    expect(points.length).toBeGreaterThanOrEqual(1);
    expect(points.length).toBeLessThanOrEqual(20);
  });

  test('caps cells at default max for a large city viewport (e.g. Chicago)', () => {
    const viewport = {
      northeast: { lat: 42.2, lng: -87.2 },
      southwest: { lat: 41.3, lng: -88.1 },
    };
    const points = generateSearchGrid(41.75, -87.65, { viewport });
    expect(points.length).toBeGreaterThanOrEqual(1);
    expect(points.length).toBeLessThanOrEqual(20);
  });

  test('grid center point matches input coordinates for no-viewport 3×3', () => {
    const points = generateSearchGrid(41.25, -96.01);
    const center = points[Math.floor(points.length / 2)];
    expect(center.lat).toBeCloseTo(41.25, 4);
    expect(center.lng).toBeCloseTo(-96.01, 4);
  });

  test('respects options.maxPoints for a wide viewport', () => {
    const viewport = {
      northeast: { lat: 42.2, lng: -87.2 },
      southwest: { lat: 41.3, lng: -88.1 },
    };
    const points = generateSearchGrid(41.75, -87.65, { viewport, maxPoints: 3 });
    expect(points.length).toBeLessThanOrEqual(3);
  });
});
