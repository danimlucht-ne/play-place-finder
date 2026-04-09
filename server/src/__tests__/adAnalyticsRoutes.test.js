jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/adTrackingService', () => ({
  getCampaignAnalytics: jest.fn(),
  getCampaignListMetricsBatch: jest.fn(),
}));
jest.mock('../services/adCampaignDisplayHelpers', () => ({
  calendarYmdFromValue: jest.fn((value) => (value ? '2026-04-09' : null)),
  regionKeyToLabelMap: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const adTrackingService = require('../services/adTrackingService');
const { regionKeyToLabelMap } = require('../services/adCampaignDisplayHelpers');
const adAnalyticsRoutes = require('../routes/adAnalyticsRoutes');

function buildApp(uid = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid };
    next();
  });
  app.use('/', adAnalyticsRoutes);
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

describe('adAnalyticsRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    regionKeyToLabelMap.mockResolvedValue({ 'omaha-ne': 'Omaha, NE' });
  });

  test('returns an empty campaign list when authenticated user has no advertiser record', async () => {
    getDb.mockReturnValue(makeDb({
      advertisers: { findOne: jest.fn().mockResolvedValue(null) },
    }));

    const res = await request(buildApp()).get('/campaigns').expect(200);

    expect(res.body).toEqual({ message: 'success', data: [] });
  });

  test('lists advertiser campaigns with creative preview, labels, and CTR', async () => {
    const advertiserId = new ObjectId();
    const campaignId = new ObjectId();
    const submissionId = new ObjectId();
    const creativeId = new ObjectId();
    const startDate = new Date('2026-04-01T00:00:00Z');
    const endDate = new Date('2026-04-30T00:00:00Z');
    const metricsMap = new Map();
    metricsMap.set(campaignId.toHexString(), { impressions: 100, clicks: 25, ctr: 0.25 });
    adTrackingService.getCampaignListMetricsBatch.mockResolvedValue(metricsMap);
    const campaigns = [{
      _id: campaignId,
      advertiserId,
      submissionId,
      creativeId,
      impressions: 999,
      clicks: 999,
      placement: 'featured_home',
      status: 'active',
      targetedRegionKeys: ['omaha-ne'],
      startDate,
      endDate,
      startDateCalendar: '2026-04-01',
      endDateCalendar: '2026-04-30',
      targetingRadiusMiles: 10,
    }];
    const creatives = [{
      _id: creativeId,
      headline: 'Indoor fun',
      imageUrl: 'https://example.com/ad.jpg',
      businessName: 'Tiny Gym',
    }];
    getDb.mockReturnValue(makeDb({
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
      adCampaigns: { find: jest.fn().mockReturnValue(makeCursor(campaigns)) },
      adCreatives: { find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(creatives) }) },
    }));

    const res = await request(buildApp()).get('/campaigns').expect(200);

    expect(adTrackingService.getCampaignListMetricsBatch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({
        _id: campaignId,
        startDate,
        endDate,
      })]),
    );
    expect(res.body).toEqual({
      message: 'success',
      data: [{
        _id: campaignId.toHexString(),
        submissionId: submissionId.toHexString(),
        impressions: 100,
        clicks: 25,
        ctr: 0.25,
        headline: 'Indoor fun',
        imageUrl: 'https://example.com/ad.jpg',
        businessName: 'Tiny Gym',
        placement: 'featured_home',
        status: 'active',
        targetedRegionKeys: ['omaha-ne'],
        targetedCityLabels: ['Omaha, NE'],
        startDateCalendar: '2026-04-01',
        endDateCalendar: '2026-04-30',
        targetingRadiusMiles: 10,
        cityId: '',
        isDemoCampaign: false,
      }],
    });
    expect(regionKeyToLabelMap).toHaveBeenCalledWith(expect.any(Object), ['omaha-ne']);
  });

  test('returns 404 for a missing campaign detail', async () => {
    getDb.mockReturnValue(makeDb({
      adCampaigns: { findOne: jest.fn().mockResolvedValue(null) },
    }));

    const res = await request(buildApp()).get(`/campaigns/${new ObjectId().toHexString()}`).expect(404);

    expect(res.body).toEqual({ error: 'Campaign not found' });
  });

  test('returns 403 when campaign is owned by a different advertiser', async () => {
    const ownerId = new ObjectId();
    const otherAdvertiserId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      adCampaigns: { findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), advertiserId: ownerId }) },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: otherAdvertiserId, userId: 'user-1' }) },
    }));

    const res = await request(buildApp()).get(`/campaigns/${new ObjectId().toHexString()}`).expect(403);

    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  test('returns detailed analytics for an owned campaign', async () => {
    const advertiserId = new ObjectId();
    const campaignId = new ObjectId();
    const submissionId = new ObjectId();
    const creativeId = new ObjectId();
    const startDate = new Date('2026-04-01T00:00:00Z');
    const endDate = new Date('2026-04-30T00:00:00Z');
    adTrackingService.getCampaignAnalytics.mockResolvedValue({
      impressions: 8,
      clicks: 2,
      ctr: 0.25,
      daily: [],
    });
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({
          _id: campaignId,
          advertiserId,
          submissionId,
          creativeId,
          startDate,
          endDate,
          cityId: 'omaha-ne',
          status: 'active',
        }),
      },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({ _id: submissionId, creativeId }),
      },
      adCreatives: {
        findOne: jest.fn().mockResolvedValue({
          _id: creativeId,
          headline: 'Indoor fun',
          body: 'Come play',
          imageUrl: 'https://example.com/ad.jpg',
          ctaText: 'Book now',
          ctaUrl: 'https://example.com',
          businessName: 'Tiny Gym',
        }),
      },
    }));

    const res = await request(buildApp()).get(`/campaigns/${campaignId.toHexString()}`).expect(200);

    expect(adTrackingService.getCampaignAnalytics).toHaveBeenCalledWith(campaignId, startDate, endDate);
    expect(res.body.message).toBe('success');
    expect(res.body.data.analytics).toEqual({ impressions: 8, clicks: 2, ctr: 0.25, daily: [] });
    expect(res.body.data.campaign).toMatchObject({
      _id: campaignId.toHexString(),
      advertiserId: advertiserId.toHexString(),
      submissionId: submissionId.toHexString(),
      creativeId: creativeId.toHexString(),
      targetedRegionKeys: ['omaha-ne'],
      targetedCityLabels: ['Omaha, NE'],
      creativePreview: {
        headline: 'Indoor fun',
        body: 'Come play',
        imageUrl: 'https://example.com/ad.jpg',
        ctaText: 'Book now',
        ctaUrl: 'https://example.com',
        businessName: 'Tiny Gym',
      },
      pendingCreativePreview: null,
    });
  });

  test('includes pendingCreativePreview when submission points at a staged creative', async () => {
    const advertiserId = new ObjectId();
    const campaignId = new ObjectId();
    const submissionId = new ObjectId();
    const liveCreativeId = new ObjectId();
    const stagedCreativeId = new ObjectId();
    const startDate = new Date('2026-04-01T00:00:00Z');
    const endDate = new Date('2026-04-30T00:00:00Z');
    adTrackingService.getCampaignAnalytics.mockResolvedValue({
      impressions: 1,
      clicks: 0,
      ctr: 0,
      daily: [],
    });
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({
          _id: campaignId,
          advertiserId,
          submissionId,
          creativeId: liveCreativeId,
          startDate,
          endDate,
          cityId: 'omaha-ne',
          status: 'active',
        }),
      },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({ _id: submissionId, creativeId: stagedCreativeId }),
      },
      adCreatives: {
        findOne: jest.fn().mockImplementation((q) => {
          const id = q._id;
          if (id.equals(liveCreativeId)) {
            return {
              _id: liveCreativeId,
              headline: 'Live headline',
              body: 'Live body text here.',
              imageUrl: 'https://example.com/live.jpg',
              ctaText: 'Book',
              ctaUrl: 'https://example.com',
              businessName: 'Tiny Gym',
            };
          }
          if (id.equals(stagedCreativeId)) {
            return {
              _id: stagedCreativeId,
              headline: 'Live headline',
              body: 'Live body text here.',
              imageUrl: 'https://example.com/pending.jpg',
              ctaText: 'Book',
              ctaUrl: 'https://example.com',
              businessName: 'Tiny Gym',
            };
          }
          return null;
        }),
      },
    }));

    const res = await request(buildApp()).get(`/campaigns/${campaignId.toHexString()}`).expect(200);

    expect(res.body.data.campaign.creativePreview.imageUrl).toBe('https://example.com/live.jpg');
    expect(res.body.data.campaign.pendingCreativePreview.imageUrl).toBe('https://example.com/pending.jpg');
  });

  test('returns 400 for malformed campaign ids', async () => {
    getDb.mockReturnValue(makeDb({}));

    const res = await request(buildApp()).get('/campaigns/not-an-object-id').expect(400);

    expect(res.body).toEqual({ error: 'Invalid campaign id' });
  });
});
