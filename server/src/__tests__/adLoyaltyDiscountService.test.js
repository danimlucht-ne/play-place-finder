jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/advertiserEmailService', () => ({
  notifyAdvertiser: jest.fn().mockResolvedValue(undefined),
  resolveAdDisplayName: jest.fn().mockResolvedValue('Test Ad'),
}));

const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const { notifyAdvertiser } = require('../services/advertiserEmailService');
const {
  issueLoyaltyDiscountOnCampaignCompletion,
  processMidCampaignLoyaltyDiscounts,
} = require('../services/adLoyaltyDiscountService');

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

describe('adLoyaltyDiscountService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('issueLoyaltyDiscountOnCampaignCompletion inserts code and emails once', async () => {
    const campaignId = new ObjectId();
    const insertOne = jest.fn().mockResolvedValue({ insertedId: new ObjectId() });
    getDb.mockReturnValue(makeDb({
      discountCodes: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne,
      },
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({
          _id: campaignId,
          advertiserId: new ObjectId(),
          creativeId: new ObjectId(),
          totalPriceInCents: 5000,
        }),
      },
    }));

    await issueLoyaltyDiscountOnCampaignCompletion(campaignId);

    expect(insertOne).toHaveBeenCalled();
    expect(notifyAdvertiser).toHaveBeenCalledWith(
      expect.any(Object),
      'campaign_completed_next_discount',
      expect.objectContaining({ percentOff: 20, code: expect.stringMatching(/^NEXT20-/) }),
    );
  });

  test('processMidCampaignLoyaltyDiscounts issues only for active campaigns past temporal midpoint', async () => {
    const pastMid = {
      _id: new ObjectId(),
      status: 'active',
      totalPriceInCents: 1000,
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-20T00:00:00Z'),
    };
    const beforeMid = {
      _id: new ObjectId(),
      status: 'active',
      totalPriceInCents: 1000,
      startDate: new Date('2026-06-14T00:00:00Z'),
      endDate: new Date('2026-07-14T00:00:00Z'),
    };
    const insertOne = jest.fn().mockResolvedValue({ insertedId: new ObjectId() });
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        find: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([pastMid, beforeMid]),
        }),
        findOne: jest.fn().mockResolvedValue({
          _id: pastMid._id,
          advertiserId: new ObjectId(),
          creativeId: new ObjectId(),
          totalPriceInCents: 1000,
          endDate: pastMid.endDate,
        }),
      },
      discountCodes: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne,
      },
    }));

    const issued = await processMidCampaignLoyaltyDiscounts();

    expect(issued).toBe(1);
    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(notifyAdvertiser).toHaveBeenCalledWith(
      expect.any(Object),
      'campaign_midpoint_next_discount',
      expect.objectContaining({ code: expect.stringMatching(/^NEXT20-/) }),
    );
  });
});
