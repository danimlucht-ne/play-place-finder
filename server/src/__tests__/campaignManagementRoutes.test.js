jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/campaignEditService', () => ({
  updateCreative: jest.fn(),
  updateEventFields: jest.fn(),
}));
jest.mock('../services/stripeService', () => ({ releaseAuthorization: jest.fn() }));
jest.mock('../services/cityPhaseService', () => ({ incrementSlot: jest.fn() }));
jest.mock('../services/advertiserEmailService', () => ({
  notifyAdvertiser: jest.fn(),
  resolveAdDisplayName: jest.fn().mockResolvedValue(''),
}));

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const campaignEditService = require('../services/campaignEditService');
const stripeService = require('../services/stripeService');
const cityPhaseService = require('../services/cityPhaseService');
const { notifyAdvertiser } = require('../services/advertiserEmailService');
const campaignManagementRoutes = require('../routes/campaignManagementRoutes');

function buildApp(uid = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid };
    next();
  });
  app.use('/', campaignManagementRoutes);
  return app;
}

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

describe('campaignManagementRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('rejects malformed campaign ids before database lookup', async () => {
    const res = await request(buildApp()).put('/bad-id/creative').send({ headline: 'New' }).expect(400);

    expect(res.body).toEqual({ error: 'Invalid campaign ID' });
    expect(getDb).toHaveBeenCalled();
  });

  test('returns 403 when authenticated user does not own the campaign', async () => {
    const campaignId = new ObjectId();
    const advertiserId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      adCampaigns: { findOne: jest.fn().mockResolvedValue({ _id: campaignId, advertiserId }) },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'other-user' }) },
    }));

    const res = await request(buildApp()).put(`/${campaignId.toHexString()}/creative`).send({ headline: 'New' }).expect(403);

    expect(res.body).toEqual({ error: 'Forbidden' });
    expect(campaignEditService.updateCreative).not.toHaveBeenCalled();
  });

  test('moves scheduled creative edits back to pending review and creates a review flag', async () => {
    const campaignId = new ObjectId();
    const advertiserId = new ObjectId();
    const submissionId = new ObjectId();
    const campaign = {
      _id: campaignId,
      advertiserId,
      submissionId,
      status: 'scheduled',
    };
    const updateCampaign = jest.fn();
    const updateSubmission = jest.fn();
    const insertReviewFlag = jest.fn();
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue(campaign),
        updateOne: updateCampaign,
      },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
      adSubmissions: { updateOne: updateSubmission },
      reviewFlags: { insertOne: insertReviewFlag },
    }));
    campaignEditService.updateCreative.mockResolvedValue({ success: true });

    const res = await request(buildApp()).put(`/${campaignId.toHexString()}/creative`).send({
      headline: 'Fresh copy',
    }).expect(200);

    expect(campaignEditService.updateCreative).toHaveBeenCalledWith(campaignId, { headline: 'Fresh copy' });
    expect(updateCampaign).toHaveBeenCalledWith(
      { _id: campaignId },
      { $set: { status: 'pending_review', updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(updateSubmission).toHaveBeenCalledWith(
      { _id: submissionId },
      {
        $set: {
          status: 'manual_review',
          updatedAt: new Date('2026-04-09T12:00:00Z'),
          reviewRequestedByUserAt: new Date('2026-04-09T12:00:00Z'),
        },
      },
    );
    expect(insertReviewFlag).toHaveBeenCalledWith(expect.objectContaining({
      submissionId,
      flagType: 'user_requested_changes',
      description: 'User changed campaign details before launch. Re-review required.',
    }));
    expect(res.body).toEqual({ message: 'success' });
  });

  /**
   * Post-live creative edits: updateCreative writes to adCreatives immediately after automated
   * headline/body checks; we do not queue manual_review for active campaigns (only scheduled/pending_review).
   * If product policy requires staging every post-live change, extend PUT /:id/creative accordingly.
   */
  test('active campaign creative edits succeed without manual_review queue', async () => {
    const campaignId = new ObjectId();
    const advertiserId = new ObjectId();
    const submissionId = new ObjectId();
    const updateCampaign = jest.fn();
    const updateSubmission = jest.fn();
    const insertReviewFlag = jest.fn();
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({
          _id: campaignId,
          advertiserId,
          submissionId,
          status: 'active',
        }),
        updateOne: updateCampaign,
      },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
      adSubmissions: { updateOne: updateSubmission },
      reviewFlags: { insertOne: insertReviewFlag },
    }));
    campaignEditService.updateCreative.mockResolvedValue({ success: true });

    const res = await request(buildApp()).put(`/${campaignId.toHexString()}/creative`).send({
      headline: 'Post-live headline edit',
    }).expect(200);

    expect(campaignEditService.updateCreative).toHaveBeenCalledWith(campaignId, { headline: 'Post-live headline edit' });
    expect(updateCampaign).not.toHaveBeenCalled();
    expect(updateSubmission).not.toHaveBeenCalled();
    expect(insertReviewFlag).not.toHaveBeenCalled();
    expect(res.body).toEqual({ message: 'success' });
  });

  test('returns validation errors from event edit service without status changes', async () => {
    const campaignId = new ObjectId();
    const advertiserId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      adCampaigns: { findOne: jest.fn().mockResolvedValue({ _id: campaignId, advertiserId, status: 'active' }) },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
    }));
    campaignEditService.updateEventFields.mockResolvedValue({ success: false, error: 'Invalid event date' });

    const res = await request(buildApp()).put(`/${campaignId.toHexString()}/event`).send({}).expect(400);

    expect(res.body).toEqual({ error: 'Invalid event date' });
  });

  test('cancels active campaigns, releases targeting slots, and notifies advertiser', async () => {
    const campaignId = new ObjectId();
    const advertiserId = new ObjectId();
    const submissionId = new ObjectId();
    const campaignUpdate = jest.fn();
    const submissionUpdate = jest.fn();
    const deleteTargeting = jest.fn();
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({
          _id: campaignId,
          advertiserId,
          submissionId,
          status: 'active',
          targetedRegionKeys: ['omaha-ne', 'lincoln-ne'],
          placement: 'featured_home',
        }),
        updateOne: campaignUpdate,
      },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          advertiserId,
          paymentMode: 'manual_capture',
          paymentIntentId: 'pi_123',
        }),
        updateOne: submissionUpdate,
      },
      adTargeting: { deleteMany: deleteTargeting },
    }));
    stripeService.releaseAuthorization.mockResolvedValue();
    cityPhaseService.incrementSlot.mockResolvedValue();

    const res = await request(buildApp()).post(`/${campaignId.toHexString()}/cancel`).expect(200);

    expect(stripeService.releaseAuthorization).toHaveBeenCalledWith(
      'pi_123',
      'Advertiser cancelled before capture',
    );
    expect(campaignUpdate).toHaveBeenCalledWith(
      { _id: campaignId },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date('2026-04-09T12:00:00Z'),
          updatedAt: new Date('2026-04-09T12:00:00Z'),
        },
      },
    );
    expect(submissionUpdate).toHaveBeenCalledWith(
      { _id: submissionId },
      { $set: { status: 'cancelled', updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(deleteTargeting).toHaveBeenCalledWith({ campaignId });
    expect(cityPhaseService.incrementSlot).toHaveBeenCalledWith('omaha-ne', 'featured');
    expect(cityPhaseService.incrementSlot).toHaveBeenCalledWith('lincoln-ne', 'featured');
    expect(notifyAdvertiser).toHaveBeenCalledWith(advertiserId, 'campaign_cancelled', {
      refundAmount: 0,
      adDisplayName: '',
    });
    expect(res.body).toEqual({
      message: 'success',
      data: { cancelled: true, refundAmountInCents: 0 },
    });
  });

  test('refund estimate keeps advertiser self-cancellation non-refundable', async () => {
    const campaignId = new ObjectId();
    const advertiserId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      adCampaigns: { findOne: jest.fn().mockResolvedValue({ _id: campaignId, advertiserId, status: 'active' }) },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
    }));

    const res = await request(buildApp()).get(`/${campaignId.toHexString()}/refund-estimate`).expect(200);

    expect(res.body).toEqual({
      message: 'success',
      data: {
        refundAmountInCents: 0,
        remainingDays: 0,
        totalDays: 0,
      },
    });
  });
});
