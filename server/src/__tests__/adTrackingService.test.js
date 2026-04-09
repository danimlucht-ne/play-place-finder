jest.mock('../database', () => ({ getDb: jest.fn() }));

const { getDb } = require('../database');
const { recordEvent, getCampaignAnalytics } = require('../services/adTrackingService');

describe('adTrackingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('deduplicates same-user impressions within one hour', async () => {
    const findOne = jest.fn().mockResolvedValue({ _id: 'existing' });
    const insertOne = jest.fn();
    const updateOne = jest.fn();
    const collection = jest.fn((name) => {
      if (name === 'adEvents') return { findOne, insertOne };
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: 'campaign-1',
            status: 'active',
            startDate: new Date('2026-04-01T00:00:00Z'),
            endDate: new Date('2026-04-30T00:00:00Z'),
          }),
          updateOne,
        };
      }
      if (name === 'adTargeting') return { findOne: jest.fn().mockResolvedValue({ campaignId: 'campaign-1' }) };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await recordEvent({
      type: 'impression',
      adId: 'campaign-1',
      campaignId: 'campaign-1',
      cityId: 'omaha-ne',
      placement: 'featured_home',
      visitorKey: 'visitor-1',
    });

    expect(findOne).toHaveBeenCalledWith({
      type: 'impression',
      adId: 'campaign-1',
      visitorKey: 'visitor-1',
      timestamp: { $gte: new Date('2026-04-09T11:00:00Z') },
    });
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('records clicks and increments campaign click counter', async () => {
    const insertOne = jest.fn().mockResolvedValue({});
    const updateOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn((name) => {
      if (name === 'adEvents') return { insertOne };
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: 'campaign-1',
            status: 'active',
            startDate: new Date('2026-04-01T00:00:00Z'),
            endDate: new Date('2026-04-30T00:00:00Z'),
          }),
          updateOne,
        };
      }
      if (name === 'adTargeting') return { findOne: jest.fn().mockResolvedValue({ campaignId: 'campaign-1' }) };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await recordEvent({
      type: 'click',
      adId: 'campaign-1',
      campaignId: 'campaign-1',
      cityId: 'omaha-ne',
      placement: 'inline_listing',
    });

    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      type: 'click',
      campaignId: 'campaign-1',
      timestamp: new Date('2026-04-09T12:00:00Z'),
    }));
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'campaign-1' },
      { $inc: { clicks: 1 } },
    );
  });

  test('rejects paid events for campaigns not targeted to the requested city placement', async () => {
    const collection = jest.fn((name) => {
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: 'campaign-1',
            startDate: new Date('2026-04-01T00:00:00Z'),
            endDate: new Date('2026-04-30T00:00:00Z'),
          }),
        };
      }
      if (name === 'adTargeting') return { findOne: jest.fn().mockResolvedValue(null) };
      if (name === 'adEvents') return { insertOne: jest.fn() };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await expect(recordEvent({
      type: 'impression',
      adId: 'campaign-1',
      campaignId: 'campaign-1',
      cityId: 'lincoln-ne',
      placement: 'featured_home',
      visitorKey: 'visitor-1',
    })).rejects.toThrow('Campaign is not targeted to this city and placement');
  });

  test('aggregates campaign totals and daily click-through rates', async () => {
    const aggregate = jest.fn()
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          { _id: 'impression', count: 10 },
          { _id: 'click', count: 2 },
        ]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([{ count: 4 }]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          { _id: { date: '2026-04-09', type: 'impression' }, count: 5, visitors: ['a', 'b'] },
          { _id: { date: '2026-04-09', type: 'click' }, count: 1 },
          { _id: { date: '2026-04-10', type: 'impression' }, count: 5, visitors: ['c', 'd'] },
        ]),
      });
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'adEvents') return { aggregate };
        if (name === 'adCampaignDailyStats') {
          return { find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }) };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    const analytics = await getCampaignAnalytics(
      'campaign-1',
      new Date('2026-04-01T00:00:00Z'),
      new Date('2026-04-30T23:59:59Z'),
    );

    expect(analytics).toEqual({
      impressions: 10,
      clicks: 2,
      ctr: 0.2,
      uniqueReach: 4,
      frequency: 2.5,
      daily: [
        { date: '2026-04-09', impressions: 5, clicks: 1, uniqueReach: 2, frequency: 2.5, ctr: 0.2 },
        { date: '2026-04-10', impressions: 5, clicks: 0, uniqueReach: 2, frequency: 2.5, ctr: 0 },
      ],
    });
    expect(aggregate.mock.calls[0][0][0].$match).toEqual({
      campaignId: 'campaign-1',
      timestamp: {
        $gte: new Date('2026-04-01T00:00:00Z'),
        $lte: new Date('2026-04-30T23:59:59Z'),
      },
    });
  });

  test('prefers durable daily rollups and merges raw days not yet rolled up', async () => {
    const aggregate = jest.fn()
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([{ _id: 'impression', count: 3 }]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([{ count: 1 }]) })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          { _id: { date: '2026-04-10', type: 'impression' }, count: 3, visitors: ['c'] },
          { _id: { date: '2026-04-10', type: 'click' }, count: 1 },
        ]),
      });
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'adEvents') return { aggregate };
        if (name === 'adCampaignDailyStats') {
          return {
            find: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue([
                { ymd: '2026-04-09', impressions: 8, clicks: 2, uniqueReach: 4, frequency: 2, ctr: 0.25 },
              ]),
            }),
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    const analytics = await getCampaignAnalytics(
      'campaign-1',
      new Date('2026-04-09T00:00:00Z'),
      new Date('2026-04-10T23:59:59Z'),
    );

    expect(analytics).toEqual({
      impressions: 11,
      clicks: 3,
      ctr: 3 / 11,
      uniqueReach: 5,
      frequency: 11 / 5,
      daily: [
        { date: '2026-04-09', impressions: 8, clicks: 2, uniqueReach: 4, frequency: 2, ctr: 0.25 },
        { date: '2026-04-10', impressions: 3, clicks: 1, uniqueReach: 1, frequency: 3, ctr: 1 / 3 },
      ],
    });
  });
});
