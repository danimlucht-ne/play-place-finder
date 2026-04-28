jest.mock('../database', () => ({ getDb: jest.fn() }));

const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const { recordEvent, getCampaignAnalytics, getCampaignListMetricsBatch } = require('../services/adTrackingService');

describe('adTrackingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('deduplicates same-user impressions within one hour (atomic dedupe)', async () => {
    const campaignId = new ObjectId();
    const adEventsInsert = jest.fn().mockResolvedValue({});
    const updateOne = jest.fn();
    const dedupeInsert = jest.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    const collection = jest.fn((name) => {
      if (name === 'adImpressionDedupes') return { insertOne: dedupeInsert };
      if (name === 'adEvents') return { insertOne: adEventsInsert };
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: campaignId,
            status: 'active',
            startDate: new Date('2026-04-01T00:00:00Z'),
            endDate: new Date('2026-04-30T00:00:00Z'),
          }),
          updateOne,
        };
      }
      if (name === 'adTargeting') return { findOne: jest.fn().mockResolvedValue({ campaignId }) };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    const payload = {
      type: 'impression',
      adId: campaignId.toHexString(),
      campaignId: campaignId.toHexString(),
      cityId: 'omaha-ne',
      placement: 'featured_home',
      visitorKey: 'visitor-1',
    };

    await recordEvent(payload);
    await recordEvent(payload);

    expect(adEventsInsert).toHaveBeenCalledTimes(1);
    expect(dedupeInsert).toHaveBeenCalledTimes(2);
  });

  test('records clicks and increments campaign click counter', async () => {
    const campaignId = new ObjectId();
    const insertOne = jest.fn().mockResolvedValue({});
    const updateOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn((name) => {
      if (name === 'adEvents') return { insertOne };
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: campaignId,
            status: 'active',
            startDate: new Date('2026-04-01T00:00:00Z'),
            endDate: new Date('2026-04-30T00:00:00Z'),
          }),
          updateOne,
        };
      }
      if (name === 'adTargeting') return { findOne: jest.fn().mockResolvedValue({ campaignId }) };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await recordEvent({
      type: 'click',
      adId: campaignId.toHexString(),
      campaignId: campaignId.toHexString(),
      cityId: 'omaha-ne',
      placement: 'inline_listing',
    });

    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      type: 'click',
      campaignId,
      timestamp: new Date('2026-04-09T12:00:00Z'),
    }));
    expect(updateOne).toHaveBeenCalledWith(
      { _id: campaignId },
      { $inc: { clicks: 1 } },
    );
  });

  test('rejects events without a valid campaignId', async () => {
    getDb.mockReturnValue({ collection: jest.fn() });

    await expect(recordEvent({
      type: 'click',
      adId: '507f1f77bcf86cd799439011',
      cityId: 'omaha-ne',
      placement: 'inline_listing',
    })).rejects.toThrow('campaignId is required and must be a valid ObjectId');

    await expect(recordEvent({
      type: 'click',
      adId: '507f1f77bcf86cd799439011',
      campaignId: 'not-valid',
      cityId: 'omaha-ne',
      placement: 'inline_listing',
    })).rejects.toThrow('campaignId is required and must be a valid ObjectId');
  });

  test('rejects paid events for campaigns not targeted to the requested city placement', async () => {
    const campaignId = new ObjectId();
    const collection = jest.fn((name) => {
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: campaignId,
            status: 'active',
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
      adId: campaignId.toHexString(),
      campaignId: campaignId.toHexString(),
      cityId: 'lincoln-ne',
      placement: 'featured_home',
      visitorKey: 'visitor-1',
    })).rejects.toThrow('Campaign is not targeted to this city and placement');
  });

  test('map_sponsored_pin matches inline_listing adTargeting', async () => {
    const campaignId = new ObjectId();
    const findTargeting = jest.fn().mockResolvedValue({ campaignId, placement: 'inline_listing' });
    const adEventsInsert = jest.fn().mockResolvedValue({});
    const updateOne = jest.fn();
    const collection = jest.fn((name) => {
      if (name === 'adImpressionDedupes') return { insertOne: jest.fn().mockResolvedValue({}) };
      if (name === 'adEvents') return { insertOne: adEventsInsert };
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: campaignId,
            status: 'active',
            startDate: new Date('2026-04-01T00:00:00Z'),
            endDate: new Date('2026-04-30T00:00:00Z'),
          }),
          updateOne,
        };
      }
      if (name === 'adTargeting') return { findOne: findTargeting };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await recordEvent({
      type: 'impression',
      adId: campaignId.toHexString(),
      campaignId: campaignId.toHexString(),
      cityId: 'omaha-ne',
      placement: 'map_sponsored_pin',
      visitorKey: 'visitor-map',
    });

    expect(findTargeting).toHaveBeenCalledWith(expect.objectContaining({
      placement: { $in: ['map_sponsored_pin', 'inline_listing'] },
    }));
    expect(adEventsInsert).toHaveBeenCalled();
  });

  test('getCampaignListMetricsBatch aggregates per campaign in batched queries', async () => {
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const start = new Date('2026-04-01T00:00:00Z');
    const end = new Date('2026-04-30T00:00:00Z');
    const aggregate = jest.fn()
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          { _id: { cid: c1, typ: 'impression' }, count: 10 },
          { _id: { cid: c1, typ: 'click' }, count: 2 },
          { _id: { cid: c2, typ: 'impression' }, count: 5 },
        ]),
      })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) });
    const find = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'adEvents') return { aggregate };
        if (name === 'adCampaignDailyStats') return { find };
        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    const map = await getCampaignListMetricsBatch([
      { _id: c1, startDate: start, endDate: end },
      { _id: c2, startDate: start, endDate: end },
    ]);

    expect(map.get(c1.toHexString())).toEqual({ impressions: 10, clicks: 2, ctr: 0.2 });
    expect(map.get(c2.toHexString())).toEqual({ impressions: 5, clicks: 0, ctr: 0 });
    expect(aggregate).toHaveBeenCalledTimes(2);
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
      })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) });
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'adEvents') return { aggregate };
        if (name === 'adCampaignDailyStats') {
          return { find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }) };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    const campaignId = new ObjectId();
    const analytics = await getCampaignAnalytics(
      campaignId,
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
      byPlacement: [],
      byCity: [],
    });
    expect(aggregate.mock.calls[0][0][0].$match).toEqual({
      campaignId,
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
      })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) });
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

    const campaignId = new ObjectId();
    const analytics = await getCampaignAnalytics(
      campaignId,
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
      byPlacement: [],
      byCity: [],
    });
  });
});
