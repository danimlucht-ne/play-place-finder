jest.mock('../database', () => ({ getDb: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getDb } = require('../database');
const healthRoutes = require('../routes/healthRoutes');

function buildApp() {
  const app = express();
  app.use('/api/health', healthRoutes);
  return app;
}

describe('healthRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns healthy status with database stats and collection counts', async () => {
    const estimatedDocumentCount = jest.fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(4);
    getDb.mockReturnValue({
      command: jest.fn().mockResolvedValue({ ok: 1 }),
      stats: jest.fn().mockResolvedValue({
        dataSize: 1024,
        storageSize: 2048,
        indexSize: 512,
        collections: 9,
        indexes: 12,
      }),
      collection: jest.fn(() => ({ estimatedDocumentCount })),
    });

    const res = await request(buildApp()).get('/api/health').expect(200);

    expect(res.body.status).toBe('healthy');
    expect(res.body.database.connected).toBe(true);
    expect(res.body.database.dataSize).toBe('1 KB');
    expect(res.body.counts).toMatchObject({
      playgrounds: 10,
      users: 3,
      seededRegions: 2,
      adCampaigns: 1,
      adSubmissions: 4,
    });
    expect(res.body).toHaveProperty('responseTimeMs');
    expect(res.body).toHaveProperty('nodeVersion');
  });

  test('returns degraded status when ping fails but stats still resolve', async () => {
    getDb.mockReturnValue({
      command: jest.fn().mockRejectedValue(new Error('ping failed')),
      stats: jest.fn().mockResolvedValue({ dataSize: 0, storageSize: 0, indexSize: 0 }),
      collection: jest.fn(() => ({ estimatedDocumentCount: jest.fn().mockResolvedValue(0) })),
    });

    const res = await request(buildApp()).get('/api/health').expect(200);

    expect(res.body.status).toBe('degraded');
    expect(res.body.database.connected).toBe(false);
  });

  test('returns unhealthy when no database connection is available', async () => {
    getDb.mockReturnValue(undefined);

    const res = await request(buildApp()).get('/api/health').expect(503);

    expect(res.body.status).toBe('unhealthy');
    expect(res.body.error).toMatch(/Cannot read/);
  });
});
