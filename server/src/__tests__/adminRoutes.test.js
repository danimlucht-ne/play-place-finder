jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/authService', () => ({
  verifyAdminToken: jest.fn((req, _res, next) => {
    req.user = { uid: 'admin-1' };
    next();
  }),
}));
jest.mock('../services/adminModerationService', () => ({
  getQueue: jest.fn(),
  getQueueItem: jest.fn(),
  approve: jest.fn(),
  reject: jest.fn(),
  retry: jest.fn(),
}));
jest.mock('../services/adminDailyTrendsService', () => ({
  getDailyTrends: jest.fn(),
  getTopContributorsByPeriod: jest.fn(),
  getContributorLeaderboard: jest.fn(),
  getAnalyticsOverview: jest.fn(),
  getCityGrowthSummary: jest.fn(),
}));
jest.mock('../services/contributionService', () => ({
  getLeaderboard: jest.fn(),
}));
jest.mock('../services/equipmentValidationService', () => ({ validate: jest.fn() }));
jest.mock('../services/venueMergeService', () => ({
  mergeRegionDuplicates: jest.fn(),
  previewRegionMerges: jest.fn(),
  previewCrossRegionAddressMerges: jest.fn(),
  mergeCrossRegionAddresses: jest.fn(),
  proximityDedup: jest.fn().mockResolvedValue({ merged: 0, archived: 0, clusters: [] }),
  previewCampusClusters: jest.fn().mockResolvedValue({ clusterCount: 0, clusters: [] }),
  previewParkAmenityClusters: jest.fn().mockResolvedValue({ clusterCount: 0, clusters: [] }),
  previewAddressSubvenueGroups: jest.fn().mockResolvedValue({ clusterCount: 0, clusters: [] }),
  canonicalizeRegionVenues: jest.fn().mockResolvedValue({
    grouping: { grouped: 0, campusGrouped: 0, parkGrouped: 0, parents: [] },
    dedup: { merged: 0, archived: 0 },
    crossRegion: { merged: 0, archived: 0, clusterCount: 0 },
  }),
  crossRegionAddressDedup: jest.fn().mockResolvedValue({ merged: 0, archived: 0, clusterCount: 0 }),
  linkSubVenues: jest.fn(),
  unlinkSubVenue: jest.fn(),
  getMergeAudit: jest.fn(),
}));
jest.mock('../services/recategorizePlaygroundTypesService', () => ({
  recategorizePlaygroundTypes: jest.fn(),
}));
jest.mock('../services/moderationStatsService', () => ({
  getUserModerationSummary: jest.fn(),
}));
jest.mock('../services/recordVerificationFromEdit', () => ({
  recordVerificationFromPlaygroundEdit: jest.fn(),
}));
jest.mock('../services/seedOrchestratorService', () => ({
  backfillSeedVerification: jest.fn(),
  backfillSeedCost: jest.fn(),
  expandRegion: jest.fn(),
  reseedAllRegions: jest.fn(),
  reseedRegion: jest.fn(),
  seedRegion: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const adminModerationService = require('../services/adminModerationService');
const trends = require('../services/adminDailyTrendsService');
const adminRoutes = require('../routes/adminRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adminRoutes);
  return app;
}

function cursor(items) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    project: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(items),
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

describe('adminRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('moderation routes delegate to adminModerationService and handle not found', async () => {
    adminModerationService.getQueue.mockResolvedValue([{ id: 'q-1' }]);
    adminModerationService.getQueueItem
      .mockResolvedValueOnce({ id: 'q-1' })
      .mockResolvedValueOnce(null);
    adminModerationService.approve.mockResolvedValue({ success: true });
    adminModerationService.reject.mockResolvedValue({ success: true });
    adminModerationService.retry.mockResolvedValue({ success: true });

    await expect(request(buildApp()).get('/moderation?status=FAILED')).resolves.toMatchObject({
      status: 200,
      body: { message: 'success', data: [{ id: 'q-1' }] },
    });
    expect(adminModerationService.getQueue).toHaveBeenCalledWith('FAILED');

    await request(buildApp()).get('/moderation/q-1').expect(200);
    await request(buildApp()).get('/moderation/missing').expect(404);

    await request(buildApp()).post('/moderation/q-1/approve').expect(200);
    expect(adminModerationService.approve).toHaveBeenCalledWith('q-1', 'admin-1');

    await request(buildApp()).post('/moderation/q-1/reject').send({ decisionReason: 'Nope' }).expect(200);
    expect(adminModerationService.reject).toHaveBeenCalledWith('q-1', 'admin-1', 'Nope');

    await request(buildApp()).post('/moderation/q-1/retry').expect(200);
    expect(adminModerationService.retry).toHaveBeenCalledWith('q-1', 'admin-1');
  });

  test('support ticket routes list, show, resolve, and reject tickets', async () => {
    const ticketId = new ObjectId('64f1a9f7c2a7d9b123456789');
    const updateOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      support_tickets: {
        find: jest.fn().mockReturnValue(cursor([{
          _id: ticketId,
          ticketType: 'question',
          category: 'general',
          message: 'Help',
          status: 'NEEDS_ADMIN_REVIEW',
          createdAt: new Date('2026-04-01T00:00:00Z'),
          targetKind: 'playground',
          targetId: 'pg-1',
        }])),
        findOne: jest.fn().mockResolvedValue({ _id: ticketId, message: 'Help' }),
        updateOne,
      },
    }));

    const list = await request(buildApp()).get('/support-tickets?status=bad-status').expect(200);
    expect(list.body.data[0]).toEqual(expect.objectContaining({
      id: ticketId.toHexString(),
      ticketType: 'question',
      message: 'Help',
    }));

    const detail = await request(buildApp()).get(`/support-tickets/${ticketId.toHexString()}`).expect(200);
    expect(detail.body.data).toEqual(expect.objectContaining({ id: ticketId.toHexString(), message: 'Help' }));

    await request(buildApp()).post(`/support-tickets/${ticketId.toHexString()}/resolve`).send({ resolutionReason: 'Done' }).expect(200);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: ticketId },
      { $set: expect.objectContaining({ status: 'RESOLVED', resolutionReason: 'Done', resolvedBy: 'admin-1' }) },
    );

    await request(buildApp()).post(`/support-tickets/${ticketId.toHexString()}/reject`).send({ resolutionReason: 'Invalid' }).expect(200);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: ticketId },
      { $set: expect.objectContaining({ status: 'REJECTED', resolutionReason: 'Invalid', rejectedBy: 'admin-1' }) },
    );
  });

  test('trend routes validate required dates and return service data', async () => {
    trends.getDailyTrends.mockResolvedValue([{ day: '2026-04-01', count: 2 }]);
    trends.getTopContributorsByPeriod.mockResolvedValue([{ userId: 'u1', score: 20 }]);
    trends.getContributorLeaderboard.mockResolvedValue([{ userId: 'u2', periodScore: 10 }]);
    trends.getAnalyticsOverview.mockResolvedValue({ contributions: { pointsAwarded: 15 }, ads: { impressions: 100 } });
    trends.getCityGrowthSummary.mockResolvedValue([{ regionKey: 'omaha-ne' }]);

    await request(buildApp()).get('/trends/daily').expect(400);
    const daily = await request(buildApp()).get('/trends/daily?startDate=2026-04-01&endDate=2026-04-09').expect(200);
    expect(daily.body.data).toEqual([{ day: '2026-04-01', count: 2 }]);
    expect(trends.getDailyTrends).toHaveBeenCalledWith('2026-04-01', '2026-04-09');

    await request(buildApp()).get('/trends/top-contributors?startDate=2026-04-01&endDate=2026-04-09&limit=500').expect(200);
    expect(trends.getTopContributorsByPeriod).toHaveBeenCalledWith('2026-04-01', '2026-04-09', 100);

    const leaderboard = await request(buildApp()).get('/trends/contributor-leaderboard?startDate=2026-04-01&endDate=2026-04-09&limit=500&regionKey=omaha-ne').expect(200);
    expect(leaderboard.body.data).toEqual([{ userId: 'u2', periodScore: 10 }]);
    expect(trends.getContributorLeaderboard).toHaveBeenCalledWith('2026-04-01', '2026-04-09', { limit: 100, regionKey: 'omaha-ne' });

    const overview = await request(buildApp()).get('/trends/overview?startDate=2026-04-01&endDate=2026-04-09&regionKey=omaha-ne').expect(200);
    expect(overview.body.data).toEqual({ contributions: { pointsAwarded: 15 }, ads: { impressions: 100 } });
    expect(trends.getAnalyticsOverview).toHaveBeenCalledWith('2026-04-01', '2026-04-09', { regionKey: 'omaha-ne' });

    const growth = await request(buildApp()).get('/trends/city-growth').expect(200);
    expect(growth.body.data).toEqual([{ regionKey: 'omaha-ne' }]);
  });
});
