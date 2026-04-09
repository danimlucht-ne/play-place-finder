jest.mock('../database', () => ({ getDb: jest.fn() }));

const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const {
  getDailyTrends,
  getTopContributorsByPeriod,
  getContributorLeaderboard,
  getContributionOverview,
  getAdPerformanceOverview,
  getAnalyticsOverview,
  getCityGrowthSummary,
} = require('../services/adminDailyTrendsService');

describe('adminDailyTrendsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns an empty range without touching the database when start is after end', async () => {
    await expect(getDailyTrends('2026-04-10', '2026-04-09')).resolves.toEqual([]);

    expect(getDb).not.toHaveBeenCalled();
  });

  test('zero-fills daily trends across all dashboard signals', async () => {
    const aggregateResults = [
      [{ date: '2026-04-01', count: 2 }],
      [{ date: '2026-04-02', count: 3 }],
      [{ date: '2026-04-01', count: 4 }],
      [{ date: '2026-04-02', count: 1 }],
      [{ date: '2026-04-01', count: 5 }],
      [{ date: '2026-04-02', count: 6 }],
    ];
    const aggregate = jest.fn(() => ({
      toArray: jest.fn().mockResolvedValue(aggregateResults.shift()),
    }));
    const collection = jest.fn(() => ({ aggregate }));
    getDb.mockReturnValue({ collection });

    await expect(getDailyTrends('2026-04-01', '2026-04-03')).resolves.toEqual([
      {
        date: '2026-04-01',
        newPlaygrounds: 2,
        photosApproved: 0,
        crowdReports: 4,
        issueReports: 0,
        newUsers: 5,
        supportTickets: 0,
      },
      {
        date: '2026-04-02',
        newPlaygrounds: 0,
        photosApproved: 3,
        crowdReports: 0,
        issueReports: 1,
        newUsers: 0,
        supportTickets: 6,
      },
      {
        date: '2026-04-03',
        newPlaygrounds: 0,
        photosApproved: 0,
        crowdReports: 0,
        issueReports: 0,
        newUsers: 0,
        supportTickets: 0,
      },
    ]);
    expect(collection.mock.calls.map(([name]) => name)).toEqual([
      'playgrounds',
      'contribution_log',
      'contribution_log',
      'contribution_log',
      'users',
      'support_tickets',
    ]);
  });

  test('gets top contributors with date bounds and caller-provided limit', async () => {
    const rows = [{ userId: 'user-1', displayName: 'Ava', score: 42, level: 3, city: 'Omaha' }];
    const aggregate = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(rows) }));
    getDb.mockReturnValue({ collection: jest.fn(() => ({ aggregate })) });

    await expect(getTopContributorsByPeriod('2026-04-01', '2026-04-30', 5)).resolves.toBe(rows);

    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.createdAt).toEqual({
      $gte: new Date('2026-04-01T00:00:00Z'),
      $lte: new Date('2026-04-30T23:59:59.999Z'),
    });
    expect(pipeline).toContainEqual({ $limit: 5 });
  });

  test('gets city growth summary from active playgrounds only', async () => {
    const rows = [{ regionKey: 'omaha-ne', totalPlaygrounds: 12, verifiedPlaygrounds: 8 }];
    const aggregate = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(rows) }));
    getDb.mockReturnValue({ collection: jest.fn(() => ({ aggregate })) });

    await expect(getCityGrowthSummary()).resolves.toBe(rows);

    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({ $match: { archivedAt: { $exists: false } } });
    expect(pipeline).toContainEqual({ $sort: { totalPlaygrounds: -1 } });
  });

  test('builds detailed contributor leaderboard with moderation summary', async () => {
    const contributionRows = [{
      userId: 'user-1',
      displayName: 'Ava',
      level: 'Local Guide',
      city: 'Omaha',
      regionKey: 'omaha-ne',
      lifetimeScore: 500,
      periodScore: 120,
      contributionCount: 6,
      photos: 2,
      edits: 3,
      newPlaygrounds: 1,
      reports: 0,
      lastContributionAt: new Date('2026-04-20T00:00:00Z'),
    }];
    const moderationRows = [
      { _id: { userId: 'user-1', outcome: 'approved' }, count: 4 },
      { _id: { userId: 'user-1', outcome: 'rejected' }, count: 1 },
    ];
    const aggregate = jest.fn()
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue(contributionRows) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue(moderationRows) });
    getDb.mockReturnValue({ collection: jest.fn(() => ({ aggregate })) });

    await expect(getContributorLeaderboard('2026-04-01', '2026-04-30', { limit: 5, regionKey: 'omaha-ne' })).resolves.toEqual([
      expect.objectContaining({
        userId: 'user-1',
        periodScore: 120,
        approved: 4,
        rejected: 1,
        approvalRate: 0.8,
        rank: 1,
      }),
    ]);
  });

  test('summarizes contribution and moderation totals for the period', async () => {
    const aggregate = jest.fn()
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([{
        pointsAwarded: 80,
        contributionCount: 7,
        activeContributors: 3,
        photos: 2,
        edits: 3,
        newPlaygrounds: 1,
        reports: 1,
      }]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([{ approved: 5, rejected: 1 }]) });
    getDb.mockReturnValue({ collection: jest.fn(() => ({ aggregate })) });

    await expect(getContributionOverview('2026-04-01', '2026-04-30', { regionKey: 'omaha-ne' })).resolves.toEqual({
      pointsAwarded: 80,
      contributionCount: 7,
      activeContributors: 3,
      photos: 2,
      edits: 3,
      newPlaygrounds: 1,
      reports: 1,
      approved: 5,
      rejected: 1,
      approvalRate: 5 / 6,
    });
  });

  test('summarizes ad performance across totals, placements, campaigns, and cities', async () => {
    const aggregate = jest.fn()
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([
        { _id: 'impression', count: 100, visitors: ['v1', 'v2', null] },
        { _id: 'click', count: 12, visitors: [] },
      ]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([
        { _id: { placement: 'featured', type: 'impression' }, count: 70 },
        { _id: { placement: 'featured', type: 'click' }, count: 10 },
      ]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([
        { _id: { campaignId: '507f1f77bcf86cd799439011', type: 'impression' }, count: 70 },
        { _id: { campaignId: '507f1f77bcf86cd799439011', type: 'click' }, count: 10 },
      ]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([
        { _id: { cityId: 'omaha-ne', type: 'impression' }, count: 70 },
        { _id: { cityId: 'omaha-ne', type: 'click' }, count: 10 },
      ]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) });
    const findCampaigns = jest.fn(() => ({
      project: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([{
        _id: new ObjectId('507f1f77bcf86cd799439011'),
        businessName: 'Bounce Town',
        status: 'active',
        creativeId: new ObjectId('507f1f77bcf86cd799439012'),
      }]),
    }));
    const findCreatives = jest.fn(() => ({
      toArray: jest.fn().mockResolvedValue([{
        _id: new ObjectId('507f1f77bcf86cd799439012'),
        headline: 'Hello',
        businessName: 'Bounce Town',
      }]),
    }));
    const countDocuments = jest.fn().mockResolvedValue(4);
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'adEvents') return { aggregate };
        if (name === 'adCampaigns') return { countDocuments, find: findCampaigns };
        if (name === 'adCreatives') return { find: findCreatives };
        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    const result = await getAdPerformanceOverview('2026-04-01', '2026-04-30');
    expect(result).toEqual(expect.objectContaining({
      activeCampaigns: 4,
      impressions: 100,
      clicks: 12,
      uniqueReach: 2,
      ctr: 0.12,
    }));
    expect(result.placements[0]).toEqual(expect.objectContaining({
      placement: 'featured',
      impressions: 70,
      clicks: 10,
      includesDemoOrTestTraffic: false,
    }));
    expect(result.topCampaigns[0]).toEqual(expect.objectContaining({
      label: 'Bounce Town',
      impressions: 70,
      clicks: 10,
      isDemoCampaign: false,
    }));
    expect(result.topCities[0]).toEqual(expect.objectContaining({ cityId: 'omaha-ne', impressions: 70, clicks: 10 }));
  });

  test('combines contribution and ad summaries into a single overview payload', async () => {
    const aggregate = jest.fn()
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([{ pointsAwarded: 10, contributionCount: 1, activeContributors: 1, photos: 1, edits: 0, newPlaygrounds: 0, reports: 0 }]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([{ approved: 1, rejected: 0 }]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([{ _id: 'impression', count: 5, visitors: ['v1'] }]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) });
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'contribution_log' || name === 'moderation_outcomes' || name === 'adEvents') return { aggregate };
        if (name === 'adCampaigns') {
          return {
            countDocuments: jest.fn().mockResolvedValue(0),
            find: jest.fn(() => ({ project: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) })),
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    const result = await getAnalyticsOverview('2026-04-01', '2026-04-30', { regionKey: 'omaha-ne' });
    expect(result).toEqual(expect.objectContaining({
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      regionKey: 'omaha-ne',
      contributions: expect.objectContaining({ pointsAwarded: 10, approved: 1 }),
      ads: expect.objectContaining({ impressions: 5 }),
    }));
  });
});
