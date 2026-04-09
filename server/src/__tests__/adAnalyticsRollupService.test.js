jest.mock('../database', () => ({ getDb: jest.fn() }));

const { getDb } = require('../database');
const {
  rollupCampaignDay,
  rollupRecentCampaignDays,
  dayBoundsUtc,
} = require('../services/adAnalyticsRollupService');

describe('adAnalyticsRollupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-10T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('computes daily totals, reach, frequency, and upserts idempotently', async () => {
    const aggregate = jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { _id: 'impression', count: 6, visitors: ['a', 'b', null] },
        { _id: 'click', count: 2, visitors: ['a'] },
      ]),
    });
    const updateOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'adEvents') return { aggregate };
        if (name === 'adCampaignDailyStats') return { updateOne };
        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    const doc = await rollupCampaignDay('campaign-1', '2026-04-09');

    expect(doc).toMatchObject({
      campaignId: 'campaign-1',
      ymd: '2026-04-09',
      impressions: 6,
      clicks: 2,
      ctr: 2 / 6,
      uniqueReach: 2,
      frequency: 3,
    });
    expect(updateOne).toHaveBeenCalledWith(
      { campaignId: 'campaign-1', ymd: '2026-04-09' },
      {
        $set: expect.objectContaining({
          impressions: 6,
          clicks: 2,
          uniqueReach: 2,
          frequency: 3,
        }),
        $setOnInsert: { createdAt: new Date('2026-04-10T12:00:00Z') },
      },
      { upsert: true },
    );
  });

  test('rolls up recent campaign days within campaign date bounds', async () => {
    const campaign = {
      _id: 'campaign-1',
      startDate: new Date('2026-04-09T00:00:00Z'),
      endDate: new Date('2026-04-10T23:59:59Z'),
    };
    const aggregate = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    const updateOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'adCampaigns') {
          return {
            find: jest.fn().mockReturnValue({
              project: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue([campaign]),
            }),
          };
        }
        if (name === 'adEvents') return { aggregate };
        if (name === 'adCampaignDailyStats') return { updateOne };
        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    const result = await rollupRecentCampaignDays(2, new Date('2026-04-10T12:00:00Z'));

    expect(result).toEqual({ campaigns: 1, days: 2, rolledUp: 2 });
    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(dayBoundsUtc('2026-04-09').start).toEqual(new Date('2026-04-09T00:00:00.000Z'));
  });
});
