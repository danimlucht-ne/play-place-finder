jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/cityPhaseService', () => ({
  getCityPhase: jest.fn(),
}));
jest.mock('../services/pricingService', () => ({
  getPhasePrice: jest.fn(),
}));
jest.mock('../services/radiusTargetingService', () => ({
  resolveRegionKeys: jest.fn(),
}));
jest.mock('../services/stripeService', () => ({
  captureOrChargeSubmission: jest.fn(),
}));
jest.mock('../services/advertiserEmailService', () => ({
  notifyAdvertiser: jest.fn(),
  resolveAdDisplayName: jest.fn().mockResolvedValue(''),
}));
jest.mock('../services/adCampaignEmailTriggers', () => ({
  notifyPaymentCapturedIfNeeded: jest.fn(),
  notifyCampaignLifecycleAfterActivation: jest.fn(),
  notifyCampaignNowLiveIfNeeded: jest.fn(),
}));
jest.mock('../services/adLoyaltyDiscountService', () => ({
  issueLoyaltyDiscountOnCampaignCompletion: jest.fn().mockResolvedValue(undefined),
  processMidCampaignLoyaltyDiscounts: jest.fn().mockResolvedValue(0),
}));

const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const cityPhaseService = require('../services/cityPhaseService');
const pricingService = require('../services/pricingService');
const radiusTargetingService = require('../services/radiusTargetingService');
const stripeService = require('../services/stripeService');
const { notifyAdvertiser } = require('../services/advertiserEmailService');
const {
  notifyPaymentCapturedIfNeeded,
  notifyCampaignLifecycleAfterActivation,
  notifyCampaignNowLiveIfNeeded,
} = require('../services/adCampaignEmailTriggers');
const { issueLoyaltyDiscountOnCampaignCompletion } = require('../services/adLoyaltyDiscountService');
const {
  activateCampaign,
  checkExpiringCampaigns,
  processIntroExpirations,
  processLifecycleTransitions,
} = require('../services/campaignLifecycleService');

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

function cursor(items) {
  return { toArray: jest.fn().mockResolvedValue(items) };
}

function baseSubmission(overrides = {}) {
  return {
    _id: new ObjectId('64f1a9f7c2a7d9b123456701'),
    advertiserId: new ObjectId('64f1a9f7c2a7d9b123456702'),
    creativeId: new ObjectId('64f1a9f7c2a7d9b123456703'),
    package: { type: 'sponsored_listing', durationDays: 30 },
    startDate: new Date('2026-04-09T00:00:00Z'),
    startDateCalendar: '2026-04-09',
    durationMonths: 1,
    totalPriceInCents: 4900,
    discountPercent: 10,
    ...overrides,
  };
}

function baseAdvertiser(overrides = {}) {
  return {
    _id: new ObjectId('64f1a9f7c2a7d9b123456702'),
    regionKey: 'omaha-ne',
    businessLat: 41.25,
    businessLng: -96.0,
    ...overrides,
  };
}

describe('campaignLifecycleService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
    pricingService.getPhasePrice.mockResolvedValue({
      isIntroPrice: false,
      priceInCents: 4900,
      standardPriceInCents: 9900,
    });
    cityPhaseService.getCityPhase.mockResolvedValue({ advertisingOpen: true, phase: 'growing' });
    radiusTargetingService.resolveRegionKeys.mockResolvedValue({
      regionKeys: ['omaha-ne', 'bellevue-ne'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('activateCampaign reuses a pending-review campaign and promotes it to active or scheduled', async () => {
    const campaignId = new ObjectId();
    const updateOne = jest.fn().mockResolvedValue({});
    const submissionId = 'sub-1';
    const newCreativeId = new ObjectId();
    const submissionUpdateOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({
          _id: campaignId,
          submissionId,
          status: 'pending_review',
          startDate: new Date('2026-04-09T09:00:00Z'),
          creativeId: new ObjectId(),
        }),
        updateOne,
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          creativeId: newCreativeId,
          pendingCampaignChanges: { eventDate: new Date('2026-04-15T00:00:00Z') },
        }),
        updateOne: submissionUpdateOne,
      },
      adTargeting: {
        countDocuments: jest.fn().mockResolvedValue(1),
        insertOne: jest.fn().mockResolvedValue({}),
      },
    }));

    await expect(activateCampaign(submissionId)).resolves.toEqual({ campaignId });

    expect(updateOne).toHaveBeenCalledWith(
      { _id: campaignId },
      { $set: {
        status: 'active',
        updatedAt: new Date('2026-04-09T12:00:00Z'),
      } },
    );
    expect(submissionUpdateOne).not.toHaveBeenCalled();
    expect(notifyCampaignLifecycleAfterActivation).toHaveBeenCalledWith(submissionId);
  });

  test('activateCampaign inserts adTargeting when existing campaign had none', async () => {
    const campaignId = new ObjectId();
    const insertTargeting = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({
          _id: campaignId,
          submissionId: 'sub-repair',
          status: 'active',
          placement: 'inline_listing',
          cityId: 'Omaha_NE',
          targetedRegionKeys: ['Omaha_NE', 'bellevue-ne'],
        }),
        updateOne: jest.fn(),
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({ _id: 'sub-repair', creativeId: new ObjectId() }),
        updateOne: jest.fn().mockResolvedValue({}),
      },
      adTargeting: {
        countDocuments: jest.fn().mockResolvedValue(0),
        insertOne: insertTargeting,
      },
    }));

    await expect(activateCampaign('sub-repair')).resolves.toEqual({ campaignId });

    expect(insertTargeting).toHaveBeenCalledTimes(2);
    expect(insertTargeting).toHaveBeenCalledWith(expect.objectContaining({ cityId: 'omaha-ne' }));
    expect(insertTargeting).toHaveBeenCalledWith(expect.objectContaining({ cityId: 'bellevue-ne' }));
    expect(notifyCampaignLifecycleAfterActivation).toHaveBeenCalledWith('sub-repair');
  });

  test('activateCampaign creates event campaigns with targeting rows', async () => {
    const campaignId = new ObjectId('64f1a9f7c2a7d9b123456799');
    const insertCampaign = jest.fn().mockResolvedValue({ insertedId: campaignId });
    const insertTargeting = jest.fn().mockResolvedValue({});
    pricingService.getPhasePrice.mockResolvedValue({
      isIntroPrice: true,
      priceInCents: 2500,
      standardPriceInCents: 10000,
    });
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: insertCampaign,
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue(baseSubmission({
          package: { type: 'event_spotlight_weekend', durationDays: 7 },
          targetingRadiusMiles: 30,
        })),
      },
      advertisers: {
        findOne: jest.fn().mockResolvedValue(baseAdvertiser()),
      },
      adCreatives: {
        findOne: jest.fn().mockResolvedValue({
          eventDate: new Date('2026-04-20T18:00:00Z'),
          isRecurring: false,
        }),
      },
      adTargeting: { insertOne: insertTargeting },
    }));

    await expect(activateCampaign(baseSubmission()._id)).resolves.toEqual({ campaignId });

    expect(insertCampaign).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      placement: 'inline_listing',
      startDateCalendar: '2026-04-09',
      endDateCalendar: '2026-05-09',
      isEvent: true,
      isRecurring: false,
      targetedRegionKeys: ['omaha-ne', 'bellevue-ne'],
      cityPhaseAtPurchase: 'growing',
      pricingLock: null,
    }));
    expect(insertTargeting).toHaveBeenCalledTimes(2);
    expect(insertTargeting).toHaveBeenCalledWith(expect.objectContaining({ cityId: 'omaha-ne', placement: 'inline_listing' }));
    expect(insertTargeting).toHaveBeenCalledWith(expect.objectContaining({ cityId: 'bellevue-ne', placement: 'inline_listing' }));
    expect(notifyCampaignLifecycleAfterActivation).toHaveBeenCalled();
  });

  test('processLifecycleTransitions captures due submissions and creates campaigns after payment succeeds', async () => {
    const submission = baseSubmission({
      status: 'approved_pending_charge',
      paymentMode: 'manual_capture',
      paymentIntentId: 'pi_due',
    });
    const paymentUpdate = jest.fn().mockResolvedValue({});
    const submissionUpdate = jest.fn().mockResolvedValue({});
    const campaignInsert = jest.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const targetingInsert = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        find: jest.fn().mockReturnValue(cursor([submission])),
        findOne: jest.fn()
          .mockResolvedValueOnce(submission)
          .mockResolvedValueOnce(submission),
        updateOne: submissionUpdate,
      },
      paymentTransactions: { updateOne: paymentUpdate },
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: campaignInsert,
        find: jest.fn()
          .mockReturnValueOnce(cursor([]))
          .mockReturnValueOnce(cursor([]))
          .mockReturnValueOnce(cursor([])),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      },
      advertisers: { findOne: jest.fn().mockResolvedValue(baseAdvertiser()) },
      adTargeting: {
        insertOne: targetingInsert,
        deleteMany: jest.fn().mockResolvedValue({}),
      },
    }));

    await expect(processLifecycleTransitions()).resolves.toEqual({
      activated: 0,
      completed: 0,
      eventExpired: 0,
    });

    expect(stripeService.captureOrChargeSubmission).toHaveBeenCalledWith(submission);
    expect(paymentUpdate).toHaveBeenCalledWith(
      { submissionId: submission._id, stripePaymentIntentId: 'pi_due' },
      { $set: { status: 'succeeded', updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(submissionUpdate).toHaveBeenCalledWith(
      { _id: submission._id },
      { $set: expect.objectContaining({ status: 'approved', paymentStatus: 'captured' }) },
    );
    expect(notifyPaymentCapturedIfNeeded).toHaveBeenCalledWith(submission._id);
    expect(campaignInsert).toHaveBeenCalled();
    expect(targetingInsert).toHaveBeenCalledTimes(2);
  });

  test('processLifecycleTransitions activates scheduled campaigns, completes ended campaigns, expires events, and releases targeting', async () => {
    const scheduled = { _id: new ObjectId(), status: 'scheduled', startDate: new Date('2026-04-09T08:00:00Z') };
    const completedCampaign = {
      _id: new ObjectId(),
      submissionId: 'sub-completed',
      status: 'completed',
      placement: 'featured_home',
      cityId: 'omaha-ne',
      targetedRegionKeys: ['omaha-ne', 'papillion-ne'],
    };
    const expiredEvent = {
      _id: new ObjectId(),
      submissionId: 'sub-event',
      status: 'active',
      isEvent: true,
      isRecurring: false,
      eventDate: new Date('2026-04-08T00:00:00Z'),
      placement: 'inline_listing',
      cityId: 'omaha-ne',
      targetedRegionKeys: ['omaha-ne'],
    };
    const campaignUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const campaignUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const targetingDelete = jest.fn().mockResolvedValue({});
    const submissionUpdate = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        find: jest.fn().mockReturnValue(cursor([])),
        updateOne: submissionUpdate,
      },
      adCampaigns: {
        find: jest.fn()
          .mockReturnValueOnce(cursor([scheduled]))
          .mockReturnValueOnce(cursor([completedCampaign]))
          .mockReturnValueOnce(cursor([expiredEvent])),
        updateOne: campaignUpdateOne,
        updateMany: campaignUpdateMany,
      },
      adTargeting: { deleteMany: targetingDelete },
    }));

    await expect(processLifecycleTransitions()).resolves.toEqual({
      activated: 1,
      completed: 1,
      eventExpired: 1,
    });

    expect(campaignUpdateOne).toHaveBeenCalledWith(
      { _id: scheduled._id, status: 'scheduled' },
      { $set: { status: 'active', updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(notifyCampaignNowLiveIfNeeded).toHaveBeenCalledWith(scheduled._id);
    expect(submissionUpdate).toHaveBeenCalledWith(
      { _id: 'sub-completed' },
      { $set: { status: 'completed', updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(submissionUpdate).toHaveBeenCalledWith(
      { _id: 'sub-event' },
      { $set: { status: 'completed', updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(targetingDelete).toHaveBeenCalledWith({ campaignId: completedCampaign._id });
    expect(targetingDelete).toHaveBeenCalledWith({ campaignId: expiredEvent._id });
    expect(issueLoyaltyDiscountOnCampaignCompletion).toHaveBeenCalledWith(completedCampaign._id);
    expect(issueLoyaltyDiscountOnCampaignCompletion).toHaveBeenCalledWith(expiredEvent._id);
  });

  test('processIntroExpirations clears expired locks and checkExpiringCampaigns sends one notification per campaign', async () => {
    const expiredLockCampaign = { _id: new ObjectId() };
    const expiringCampaign = {
      _id: new ObjectId(),
      advertiserId: 'adv-1',
      status: 'active',
      endDate: new Date('2026-04-11T12:00:00Z'),
    };
    const updateOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValueOnce(makeDb({
      adCampaigns: {
        find: jest.fn().mockReturnValue(cursor([expiredLockCampaign])),
        updateOne,
      },
    }));

    await expect(processIntroExpirations()).resolves.toEqual({ expired: 1 });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: expiredLockCampaign._id },
      { $set: { 'pricingLock.priceLockedUntil': null, updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );

    const markNotified = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        find: jest.fn().mockReturnValue(cursor([expiringCampaign])),
        updateOne: markNotified,
      },
    }));

    await expect(checkExpiringCampaigns()).resolves.toBe(1);
    expect(notifyAdvertiser).toHaveBeenCalledWith('adv-1', 'campaign_expiring_soon', {
      endDate: expiringCampaign.endDate,
      adDisplayName: '',
    });
    expect(markNotified).toHaveBeenCalledWith(
      { _id: expiringCampaign._id },
      { $set: { expiryNotificationSent: true } },
    );
  });
});
