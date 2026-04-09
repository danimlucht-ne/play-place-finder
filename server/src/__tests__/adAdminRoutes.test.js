jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/authService', () => ({
  verifyAdminToken: jest.fn((req, _res, next) => {
    req.user = { uid: 'admin-1' };
    next();
  }),
}));
jest.mock('../services/campaignLifecycleService', () => ({
  activateCampaign: jest.fn(),
  processLifecycleTransitions: jest.fn(),
  processIntroExpirations: jest.fn(),
}));
jest.mock('../services/stripeService', () => ({
  releaseAuthorization: jest.fn(),
  refund: jest.fn(),
}));
jest.mock('../services/cityPhaseService', () => ({
  setPhaseOverride: jest.fn(),
  openAdvertisingForRegion: jest.fn(),
  getCityPhase: jest.fn(),
}));
jest.mock('../services/advertiserEmailService', () => ({
  notifyAdvertiser: jest.fn(),
  resolveAdDisplayName: jest.fn().mockResolvedValue(''),
}));
jest.mock('../services/seedOrchestratorService', () => ({
  scheduleLightweightAlgorithmRecrawlForRegion: jest.fn(),
  scheduleViewportPlacesRecrawlForRegion: jest.fn().mockResolvedValue({ regionKey: 'omaha-ne', gridPointCount: 4 }),
  startFullRegionReseed: jest.fn().mockResolvedValue(undefined),
  completeAdminExpandRegion: jest.fn().mockResolvedValue(undefined),
  seededRegionCenterToLatLng: jest.fn(() => ({ lat: 41.25, lng: -96.0 })),
}));

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const campaignLifecycleService = require('../services/campaignLifecycleService');
const stripeService = require('../services/stripeService');
const cityPhaseService = require('../services/cityPhaseService');
const { notifyAdvertiser } = require('../services/advertiserEmailService');
const seedOrchestratorService = require('../services/seedOrchestratorService');
const adAdminRoutes = require('../routes/adAdminRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adAdminRoutes);
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

describe('adAdminRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('lists manual-review submissions with creative display names and review flags', async () => {
    const submissionId = new ObjectId();
    const creativeId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        find: jest.fn().mockReturnValue(cursor([{ _id: submissionId, creativeId, status: 'manual_review' }])),
      },
      reviewFlags: {
        find: jest.fn().mockReturnValue(cursor([{ submissionId, flagType: 'premium_placement' }])),
      },
      adCreatives: {
        find: jest.fn().mockReturnValue(cursor([{ _id: creativeId, headline: 'Launch Party' }])),
      },
    }));

    const res = await request(buildApp()).get('/submissions').expect(200);

    expect(res.body.message).toBe('success');
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      status: 'manual_review',
      reviewDisplayName: 'Launch Party',
      reviewFlags: [expect.objectContaining({ flagType: 'premium_placement' })],
    }));
  });

  test('approves paid submissions, activates campaign, resolves flags, and returns campaign id', async () => {
    const submissionId = new ObjectId();
    const campaignId = new ObjectId();
    const updateSubmission = jest.fn().mockResolvedValue({});
    const updateFlags = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          advertiserId: 'adv-1',
          status: 'manual_review',
        }),
        updateOne: updateSubmission,
      },
      paymentTransactions: {
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), submissionId, status: 'succeeded' }),
      },
      reviewFlags: { updateMany: updateFlags },
    }));
    campaignLifecycleService.activateCampaign.mockResolvedValue({ campaignId });

    const res = await request(buildApp())
      .post(`/submissions/${submissionId.toHexString()}/review`)
      .send({ decision: 'approve' })
      .expect(200);

    expect(updateSubmission).toHaveBeenCalledWith(
      { _id: submissionId },
      { $set: { status: 'approved', approvedAt: new Date('2026-04-09T12:00:00Z'), updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(campaignLifecycleService.activateCampaign).toHaveBeenCalledWith(submissionId);
    expect(updateFlags).toHaveBeenCalledWith(
      { submissionId, resolvedAt: null },
      { $set: { resolvedAt: new Date('2026-04-09T12:00:00Z'), resolvedBy: 'admin-1', resolution: 'approved' } },
    );
    expect(res.body.data).toEqual({ decision: 'approve', campaignId: campaignId.toHexString() });
  });

  test('rejects manual-capture submissions, releases authorization, resolves flags, and notifies advertiser', async () => {
    const submissionId = new ObjectId();
    const updateSubmission = jest.fn().mockResolvedValue({});
    const updateFlags = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          advertiserId: 'adv-1',
          paymentMode: 'manual_capture',
          paymentIntentId: 'pi_auth',
        }),
        updateOne: updateSubmission,
      },
      reviewFlags: { updateMany: updateFlags },
    }));

    const res = await request(buildApp())
      .post(`/submissions/${submissionId.toHexString()}/review`)
      .send({ decision: 'reject', reason: 'Not family friendly' })
      .expect(200);

    expect(updateSubmission).toHaveBeenCalledWith(
      { _id: submissionId },
      { $set: expect.objectContaining({ status: 'rejected', rejectionReason: 'Not family friendly' }) },
    );
    expect(stripeService.releaseAuthorization).toHaveBeenCalledWith('pi_auth', 'Not family friendly');
    expect(updateFlags).toHaveBeenCalledWith(
      { submissionId, resolvedAt: null },
      { $set: expect.objectContaining({ resolution: 'rejected', resolvedBy: 'admin-1' }) },
    );
    expect(notifyAdvertiser).toHaveBeenCalledWith('adv-1', 'campaign_rejected', {
      reason: 'Not family friendly',
      adDisplayName: '',
    });
    expect(res.body.data).toEqual({ decision: 'reject', stripeWarning: null });
  });

  test('request-revision validates message, releases payment, updates submission, resolves flags, and notifies', async () => {
    const submissionId = new ObjectId();
    await request(buildApp())
      .post(`/submissions/${submissionId.toHexString()}/request-revision`)
      .send({ message: 'no' })
      .expect(400);

    const updateSubmission = jest.fn().mockResolvedValue({});
    const updateFlags = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          status: 'manual_review',
          advertiserId: 'adv-1',
          paymentMode: 'manual_capture',
          paymentIntentId: 'pi_auth',
        }),
        updateOne: updateSubmission,
      },
      reviewFlags: { updateMany: updateFlags },
    }));

    await request(buildApp())
      .post(`/submissions/${submissionId.toHexString()}/request-revision`)
      .send({ message: 'Please replace the image.' })
      .expect(200);

    expect(stripeService.releaseAuthorization).toHaveBeenCalledWith('pi_auth', 'Admin requested creative revision');
    expect(updateSubmission).toHaveBeenCalledWith(
      { _id: submissionId },
      { $set: expect.objectContaining({
        status: 'revision_requested',
        revisionRequestMessage: 'Please replace the image.',
        paymentIntentId: null,
      }) },
    );
    expect(updateFlags).toHaveBeenCalledWith(
      { submissionId, resolvedAt: null },
      { $set: expect.objectContaining({ resolution: 'revision_requested' }) },
    );
    expect(notifyAdvertiser).toHaveBeenCalledWith('adv-1', 'campaign_revision_requested', {
      message: 'Please replace the image.',
      adDisplayName: '',
    });
  });

  test('city, region, advertiser, and lifecycle admin utility routes call the correct services', async () => {
    const updateCity = jest.fn().mockResolvedValue({});
    const deleteMany = jest.fn().mockResolvedValue({});
    const deleteOne = jest.fn().mockResolvedValue({});
    const advertiserAggregate = jest.fn().mockReturnValue(cursor([{ businessName: 'Play Cafe', submissionCount: 2 }]));
    getDb.mockReturnValue(makeDb({
      cityAdSettings: {
        find: jest.fn().mockReturnValue(cursor([{ cityId: 'omaha-ne', phase: 'growing' }])),
        findOne: jest.fn().mockResolvedValue(null),
        updateOne: updateCity,
        deleteMany,
      },
      advertisers: {
        find: jest.fn().mockReturnValue(cursor([{ _id: 'adv-1' }])),
        deleteMany,
        aggregate: advertiserAggregate,
      },
      adSubmissions: { deleteMany },
      adCampaigns: { deleteMany },
      adTargeting: { deleteMany },
      playgrounds: { deleteMany },
      seeded_regions: {
        deleteOne,
        updateOne: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockResolvedValue({ regionKey: 'omaha-ne', coverageRadiusMiles: 20 }),
      },
    }));
    campaignLifecycleService.processLifecycleTransitions.mockResolvedValue({ activated: 1, completed: 2, eventExpired: 3 });
    campaignLifecycleService.processIntroExpirations.mockResolvedValue({ expired: 4 });

    await request(buildApp()).get('/cities').expect(200);
    cityPhaseService.getCityPhase.mockResolvedValue({ phase: 'growing', advertisingOpen: true });
    cityPhaseService.openAdvertisingForRegion.mockResolvedValue(undefined);

    await request(buildApp()).put('/cities/omaha-ne/phase').send({ phase: 'growing' }).expect(200);
    expect(cityPhaseService.setPhaseOverride).toHaveBeenCalledWith('omaha-ne', 'growing');

    await request(buildApp()).post('/cities/omaha-ne/open-advertising').expect(200);
    expect(cityPhaseService.openAdvertisingForRegion).toHaveBeenCalledWith('omaha-ne');

    await request(buildApp()).delete('/regions/omaha-ne').expect(200);
    expect(deleteMany).toHaveBeenCalledWith({ regionKey: 'omaha-ne' });
    expect(deleteOne).toHaveBeenCalledWith({ regionKey: 'omaha-ne' });

    await request(buildApp()).post('/regions/omaha-ne/lightweight-reseed').expect(200);
    expect(seedOrchestratorService.scheduleLightweightAlgorithmRecrawlForRegion).toHaveBeenCalledWith('omaha-ne');

    await request(buildApp())
      .post('/regions/omaha-ne/seed-viewport')
      .send({
        southWestLat: 41.2,
        southWestLng: -96.1,
        northEastLat: 41.22,
        northEastLng: -96.05,
      })
      .expect(200);
    expect(seedOrchestratorService.scheduleViewportPlacesRecrawlForRegion).toHaveBeenCalledWith(
      'omaha-ne',
      expect.objectContaining({
        southWestLat: 41.2,
        southWestLng: -96.1,
        northEastLat: 41.22,
        northEastLng: -96.05,
      }),
      'admin-1',
      expect.objectContaining({ mode: undefined }),
    );

    await request(buildApp()).post('/regions/omaha-ne/reseed').expect(200);
    expect(seedOrchestratorService.startFullRegionReseed).toHaveBeenCalledWith('omaha-ne', 'admin-1');

    const expandDb = makeDb({
      seeded_regions: {
        findOne: jest.fn()
          .mockResolvedValueOnce({
            regionKey: 'omaha-ne',
            center: { type: 'Point', coordinates: [-96.0, 41.25] },
          })
          .mockResolvedValueOnce({ regionKey: 'omaha-ne', coverageRadiusMiles: 30 }),
        updateOne: jest.fn().mockResolvedValue({}),
      },
    });
    getDb.mockReturnValueOnce(expandDb);
    await request(buildApp()).post('/regions/omaha-ne/expand').expect(200);
    expect(seedOrchestratorService.seededRegionCenterToLatLng).toHaveBeenCalled();
    expect(expandDb.collection('seeded_regions').updateOne).toHaveBeenCalled();
    await jest.runAllTimersAsync();
    expect(seedOrchestratorService.completeAdminExpandRegion).toHaveBeenCalledWith('omaha-ne', 'admin-1');

    const advertisers = await request(buildApp()).get('/advertisers').expect(200);
    expect(advertisers.body.data).toEqual([{ businessName: 'Play Cafe', submissionCount: 2 }]);

    const lifecycle = await request(buildApp()).post('/lifecycle/run').expect(200);
    expect(lifecycle.body.data).toEqual({ activated: 1, completed: 2, eventExpired: 3, expired: 4 });
  });

  test('GET viewport-seed-preview returns last candidate list and counts', async () => {
    getDb.mockReturnValue(makeDb({
      seeded_regions: {
        findOne: jest.fn().mockResolvedValue({
          lastViewportSeedAt: new Date('2026-04-23T12:00:00Z'),
          lastViewportSeed: {
            gridPointCount: 1,
            inserted: 0,
            kidFilteredCandidates: 311,
            afterArchiveFilterCount: 293,
            candidatesPreview: [
              {
                placeId: 'ChIJx',
                name: 'Test Park',
                lat: 41.2,
                lng: -96.1,
                primaryType: 'park',
                playgroundType: 'Outdoor',
                addressSnippet: '123 St',
              },
            ],
            candidatesPreviewTruncated: false,
            southWestLat: 41.19,
            southWestLng: -96.12,
            northEastLat: 41.21,
            northEastLng: -96.05,
          },
        }),
      },
    }));

    const res = await request(buildApp()).get('/regions/omaha-ne/viewport-seed-preview').expect(200);

    expect(res.body.data.kidFilteredCandidates).toBe(311);
    expect(res.body.data.afterArchiveFilterCount).toBe(293);
    expect(res.body.data.candidatesPreview).toHaveLength(1);
    expect(res.body.data.bounds).toEqual({
      southWestLat: 41.19,
      southWestLng: -96.12,
      northEastLat: 41.21,
      northEastLng: -96.05,
    });
  });
});
