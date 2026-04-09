jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({ bucket: jest.fn(() => ({ file: jest.fn() })) })),
}));
jest.mock('../services/cityPhaseService', () => ({
  getCityPhase: jest.fn(),
  openAdvertisingForRegion: jest.fn(),
}));
jest.mock('../services/pricingService', () => ({
  getPhasePrice: jest.fn(),
  validateStartDate: jest.fn(),
  calculateMultiMonthPrice: jest.fn(),
}));
jest.mock('../services/radiusTargetingService', () => ({
  RADIUS_SURCHARGES: { 20: 0, 30: 1000, 40: 2000, 50: 3000 },
  getRadiusPreview: jest.fn(),
  resolveRegionKeys: jest.fn(),
}));
jest.mock('../services/stripeService', () => ({
  releaseAuthorization: jest.fn(),
  refund: jest.fn(),
}));
jest.mock('../services/adTrackingService', () => ({
  getCampaignAnalytics: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const cityPhaseService = require('../services/cityPhaseService');
const pricingService = require('../services/pricingService');
const radiusTargetingService = require('../services/radiusTargetingService');
const stripeService = require('../services/stripeService');
const adTrackingService = require('../services/adTrackingService');
const adSubmissionRoutes = require('../routes/adSubmissionRoutes');

function buildApp(uid = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid };
    next();
  });
  app.use('/', adSubmissionRoutes);
  return app;
}

function makeCursor(rows) {
  return {
    sort: jest.fn().mockReturnThis(),
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

describe('adSubmissionRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    console.warn.mockRestore();
    console.error.mockRestore();
  });

  test('radius preview requires region input and matching advertiser profile', async () => {
    getDb.mockReturnValue(makeDb({
      seeded_regions: { findOne: jest.fn().mockResolvedValue({ regionKey: 'omaha-ne', center: { lat: 41, lng: -96 } }) },
      advertisers: { findOne: jest.fn().mockResolvedValue({ userId: 'user-1', regionKey: 'lincoln-ne' }) },
    }));

    await request(buildApp()).get('/radius-preview').expect(400);
    const mismatch = await request(buildApp()).get('/radius-preview?regionKey=omaha-ne').expect(400);

    expect(mismatch.body).toEqual({ error: 'regionKey does not match your advertiser profile' });
  });

  test('radius preview returns service data for advertiser business coordinates', async () => {
    const data = { tiers: [{ miles: 20, regionKeys: ['omaha-ne'] }] };
    radiusTargetingService.getRadiusPreview.mockResolvedValue(data);
    getDb.mockReturnValue(makeDb({
      seeded_regions: { findOne: jest.fn().mockResolvedValue({ regionKey: 'omaha-ne', center: { lat: 41, lng: -96 } }) },
      advertisers: { findOne: jest.fn().mockResolvedValue({ userId: 'user-1', regionKey: 'omaha-ne', businessLat: 41.1, businessLng: -96.1 }) },
    }));

    const res = await request(buildApp()).get('/radius-preview?regionKey=omaha-ne').expect(200);

    expect(radiusTargetingService.getRadiusPreview).toHaveBeenCalledWith('omaha-ne', { lat: 41.1, lng: -96.1 });
    expect(res.body).toEqual({ message: 'success', data });
  });

  test('lists advertiser submissions and returns owned creative details', async () => {
    const advertiserId = new ObjectId();
    const submissionId = new ObjectId();
    const creativeId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
      adSubmissions: {
        find: jest.fn().mockReturnValue(makeCursor([{ _id: submissionId, advertiserId, creativeId }])),
        findOne: jest.fn().mockResolvedValue({ _id: submissionId, advertiserId, creativeId }),
      },
      adCreatives: { findOne: jest.fn().mockResolvedValue({ _id: creativeId, headline: 'Big fun' }) },
    }));

    const mine = await request(buildApp()).get('/mine').expect(200);
    const creative = await request(buildApp()).get(`/${submissionId.toHexString()}/creative`).expect(200);

    expect(mine.body.data).toEqual([{ _id: submissionId.toHexString(), advertiserId: advertiserId.toHexString(), creativeId: creativeId.toHexString() }]);
    expect(creative.body).toEqual({ message: 'success', data: { _id: creativeId.toHexString(), headline: 'Big fun' } });
  });

  test('creates first advertiser submission and opens advertising for the region', async () => {
    const advertiserId = new ObjectId();
    const submissionId = new ObjectId();
    const insertSubmission = jest.fn().mockResolvedValue({ insertedId: submissionId });
    getDb.mockReturnValue(makeDb({
      seeded_regions: { findOne: jest.fn().mockResolvedValue({ regionKey: 'omaha-ne' }) },
      advertisers: {
        countDocuments: jest.fn().mockResolvedValue(0),
        findOneAndUpdate: jest.fn().mockResolvedValue({ _id: advertiserId }),
      },
      adSubmissions: { insertOne: insertSubmission },
    }));
    cityPhaseService.getCityPhase.mockResolvedValue({ phase: 'seeding', advertisingOpen: false });
    cityPhaseService.openAdvertisingForRegion.mockResolvedValue(undefined);

    const res = await request(buildApp()).post('/').send({
      businessName: 'Tiny Gym',
      category: 'indoor_play',
      city: 'Omaha',
      state: 'NE',
      contactEmail: 'owner@test.invalid',
    }).expect(201);

    expect(cityPhaseService.openAdvertisingForRegion).toHaveBeenCalledWith(
      'omaha-ne',
      expect.objectContaining({
        phasePricing: expect.objectContaining({
          growing: expect.any(Object),
          mature: expect.any(Object),
        }),
      }),
    );
    expect(insertSubmission).toHaveBeenCalledWith(expect.objectContaining({
      advertiserId,
      status: 'draft',
      currentStep: 1,
    }));
    expect(res.body.data.submissionId).toBe(submissionId.toHexString());
  });

  test('saves package selection with server-side pricing and radius reach checks', async () => {
    const submissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const updateOne = jest.fn();
    const updated = { _id: submissionId, currentStep: 2, package: { type: 'featured_home' } };
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn()
          .mockResolvedValueOnce({ _id: submissionId, advertiserId, currentStep: 1 })
          .mockResolvedValueOnce(updated),
        updateOne,
      },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1', regionKey: 'omaha-ne', businessLat: 41, businessLng: -96 }) },
    }));
    pricingService.getPhasePrice.mockResolvedValue({ priceInCents: 9900 });
    pricingService.validateStartDate.mockReturnValue({ valid: true, startDate: new Date('2026-04-15T00:00:00Z') });
    pricingService.calculateMultiMonthPrice.mockReturnValue({ discountPercent: 10, totalPriceInCents: 26730 });
    radiusTargetingService.resolveRegionKeys
      .mockResolvedValueOnce({ regionKeys: ['omaha-ne'] })
      .mockResolvedValueOnce({ regionKeys: ['omaha-ne', 'lincoln-ne'] })
      .mockResolvedValue({ regionKeys: ['omaha-ne', 'lincoln-ne'] });

    const res = await request(buildApp()).put(`/${submissionId.toHexString()}`).send({
      step: 2,
      packageType: 'featured_home',
      durationMonths: 3,
      startDate: '2026-04-15',
      targetingRadiusMiles: 30,
    }).expect(200);

    expect(updateOne).toHaveBeenCalledWith(
      { _id: submissionId },
      { $set: expect.objectContaining({
        currentStep: 2,
        targetingRadiusMiles: 30,
        totalPriceInCents: 26730,
        discountPercent: 10,
      }) },
    );
    expect(res.body.data).toEqual({ _id: submissionId.toHexString(), currentStep: 2, package: { type: 'featured_home' } });
  });

  test('creates renewal draft with copied package, targeting, creative, and previous performance', async () => {
    const advertiserId = new ObjectId();
    const previousSubmissionId = new ObjectId();
    const newSubmissionId = new ObjectId();
    const oldCreativeId = new ObjectId();
    const newCreativeId = new ObjectId();
    const previousCampaignId = new ObjectId();
    const insertSubmission = jest.fn().mockResolvedValue({ insertedId: newSubmissionId });
    const updateSubmission = jest.fn().mockResolvedValue({});
    const insertCreative = jest.fn().mockResolvedValue({ insertedId: newCreativeId });
    const performance = { impressions: 100, clicks: 8, ctr: 0.08, uniqueReach: 60, frequency: 1.67, daily: [] };
    adTrackingService.getCampaignAnalytics.mockResolvedValue(performance);

    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: previousSubmissionId,
          advertiserId,
          creativeId: oldCreativeId,
          package: { type: 'inline_listing', priceInCents: 3900 },
          targetingRadiusMiles: 30,
          durationMonths: 3,
          totalPriceInCents: 9999,
          discountPercent: 15,
        }),
        insertOne: insertSubmission,
        updateOne: updateSubmission,
      },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({
          _id: previousCampaignId,
          startDate: new Date('2026-03-01T00:00:00Z'),
          endDate: new Date('2026-03-31T00:00:00Z'),
          targetingRadiusMiles: 30,
          durationMonths: 3,
        }),
      },
      adCreatives: {
        findOne: jest.fn().mockResolvedValue({
          _id: oldCreativeId,
          headline: 'Fresh fun',
          body: 'Come play inside',
          imageUrl: 'https://example.com/ad.jpg',
          ctaText: 'Book now',
          ctaUrl: 'https://example.com',
          businessName: 'Tiny Gym',
          businessCategory: 'indoor_play',
        }),
        insertOne: insertCreative,
      },
    }));

    const res = await request(buildApp()).post('/renew').send({
      previousSubmissionId: previousSubmissionId.toHexString(),
    }).expect(201);

    expect(insertSubmission).toHaveBeenCalledWith(expect.objectContaining({
      currentStep: 3,
      package: { type: 'inline_listing', priceInCents: 3900 },
      targetingRadiusMiles: 30,
      durationMonths: 3,
      totalPriceInCents: 9999,
      discountPercent: 15,
      renewalOfSubmissionId: previousSubmissionId,
      renewalOfCampaignId: previousCampaignId,
      previousPerformance: performance,
    }));
    expect(insertCreative).toHaveBeenCalledWith(expect.objectContaining({
      submissionId: newSubmissionId,
      advertiserId,
      headline: 'Fresh fun',
      status: 'draft',
    }));
    expect(updateSubmission).toHaveBeenCalledWith(
      { _id: newSubmissionId },
      { $set: { creativeId: newCreativeId } },
    );
    expect(res.body.data.renewal.previousPerformance).toEqual(performance);
    expect(res.body.data.renewal.package).toEqual({ type: 'inline_listing', priceInCents: 3900 });
  });

  test('prelaunch cancel releases authorization and marks submission/campaign cancelled', async () => {
    const submissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const campaignId = new ObjectId();
    const updateSubmission = jest.fn();
    const updateCampaign = jest.fn();
    const deleteTargeting = jest.fn();
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({ _id: submissionId, advertiserId, paymentMode: 'manual_capture', paymentIntentId: 'pi_123' }),
        updateOne: updateSubmission,
      },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({ _id: campaignId, submissionId, startDate: new Date(Date.now() + 86400000) }),
        updateOne: updateCampaign,
      },
      paymentTransactions: { findOne: jest.fn().mockResolvedValue(null) },
      adTargeting: { deleteMany: deleteTargeting },
    }));

    const res = await request(buildApp()).post(`/${submissionId.toHexString()}/prelaunch-cancel`).expect(200);

    expect(stripeService.releaseAuthorization).toHaveBeenCalledWith('pi_123', 'User cancelled before launch');
    expect(updateSubmission).toHaveBeenCalledWith({ _id: submissionId }, { $set: expect.objectContaining({ status: 'cancelled' }) });
    expect(updateCampaign).toHaveBeenCalledWith({ _id: campaignId }, { $set: expect.objectContaining({ status: 'cancelled' }) });
    expect(deleteTargeting).toHaveBeenCalledWith({ campaignId });
    expect(res.body).toEqual({ message: 'success', data: { cancelled: true, refundAmountInCents: 0 } });
  });
});
