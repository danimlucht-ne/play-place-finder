jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/authService', () => ({
  verifyAdminToken: jest.fn((req, _res, next) => {
    req.user = { uid: 'admin-1' };
    next();
  }),
}));
jest.mock('../services/refundCalculator', () => ({ calculateProRatedRefund: jest.fn() }));
jest.mock('../services/stripeService', () => ({
  partialRefund: jest.fn(),
  refund: jest.fn(),
}));
jest.mock('../services/cityPhaseService', () => ({
  incrementSlot: jest.fn(),
}));
jest.mock('../services/advertiserEmailService', () => ({
  notifyAdvertiser: jest.fn(),
  resolveAdDisplayName: jest.fn().mockResolvedValue(''),
}));

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const refundCalculator = require('../services/refundCalculator');
const stripeService = require('../services/stripeService');
const cityPhaseService = require('../services/cityPhaseService');
const { notifyAdvertiser } = require('../services/advertiserEmailService');
const adminCampaignRoutes = require('../routes/adminCampaignRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adminCampaignRoutes);
  return app;
}

function makeCursor(rows) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
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

describe('adminCampaignRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lists campaigns with filter, pagination, advertiser, and creative enrichment', async () => {
    const advertiserId = new ObjectId();
    const creativeId = new ObjectId();
    const campaigns = [{ _id: new ObjectId(), advertiserId, creativeId, status: 'active' }];
    const campaignFind = jest.fn().mockReturnValue(makeCursor(campaigns));
    getDb.mockReturnValue(makeDb({
      adCampaigns: { find: campaignFind, countDocuments: jest.fn().mockResolvedValue(1) },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, businessName: 'Account Name' }) },
      adCreatives: { findOne: jest.fn().mockResolvedValue({ _id: creativeId, businessName: 'Creative Name', headline: 'Big fun' }) },
    }));

    const res = await request(buildApp()).get('/?status=active&cityId=omaha-ne&sort=startDate&order=asc&page=2&limit=5').expect(200);

    expect(campaignFind).toHaveBeenCalledWith({ status: 'active', cityId: 'omaha-ne' });
    expect(res.body).toMatchObject({
      message: 'success',
      total: 1,
      page: 2,
      limit: 5,
      data: [{ businessName: 'Creative Name', headline: 'Big fun', status: 'active' }],
    });
  });

  test('admin cancellation prorates refunds, releases targeting, restores slots, and notifies advertiser', async () => {
    const campaignId = new ObjectId();
    const submissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const updateCampaign = jest.fn();
    const updateSubmission = jest.fn();
    const deleteTargeting = jest.fn();
    refundCalculator.calculateProRatedRefund.mockReturnValue({ refundAmountInCents: 1250 });
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({
          _id: campaignId,
          advertiserId,
          submissionId,
          status: 'active',
          startDate: new Date(Date.now() - 86400000),
          endDate: new Date(Date.now() + 86400000),
          targetedRegionKeys: ['omaha-ne', 'lincoln-ne'],
          placement: 'inline_listing',
        }),
        updateOne: updateCampaign,
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({ _id: submissionId, paymentIntentId: 'pi_123' }),
        updateOne: updateSubmission,
      },
      paymentTransactions: { findOne: jest.fn().mockResolvedValue({ stripePaymentIntentId: 'pi_123', amountInCents: 5000 }) },
      adTargeting: { deleteMany: deleteTargeting },
    }));
    stripeService.partialRefund.mockResolvedValue();
    cityPhaseService.incrementSlot.mockResolvedValue();

    const res = await request(buildApp()).post(`/${campaignId.toHexString()}/cancel`).send({ reason: 'Policy' }).expect(200);

    expect(stripeService.partialRefund).toHaveBeenCalledWith('pi_123', 1250, 'Policy', 'admin-1');
    expect(updateCampaign).toHaveBeenCalledWith(
      { _id: campaignId },
      { $set: expect.objectContaining({ status: 'cancelled', cancelledBy: 'admin-1', cancellationReason: 'Policy' }) },
    );
    expect(updateSubmission).toHaveBeenCalledWith(
      { _id: submissionId },
      { $set: expect.objectContaining({ status: 'cancelled' }) },
    );
    expect(deleteTargeting).toHaveBeenCalledWith({ campaignId });
    expect(cityPhaseService.incrementSlot).toHaveBeenCalledWith('omaha-ne', 'sponsored');
    expect(cityPhaseService.incrementSlot).toHaveBeenCalledWith('lincoln-ne', 'sponsored');
    expect(notifyAdvertiser).toHaveBeenCalledWith(advertiserId, 'campaign_cancelled', {
      refundAmount: 1250,
      adDisplayName: '',
    });
    expect(res.body).toEqual({ message: 'success', data: { cancelled: true, refundAmountInCents: 1250 } });
  });

  test('extends active campaigns by validated day counts', async () => {
    const campaignId = new ObjectId();
    const endDate = new Date('2026-04-10T00:00:00Z');
    const updateOne = jest.fn();
    getDb.mockReturnValue(makeDb({
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({ _id: campaignId, status: 'active', endDate }),
        updateOne,
      },
    }));

    await request(buildApp()).post(`/${campaignId.toHexString()}/extend`).send({ days: 0 }).expect(400);
    const res = await request(buildApp()).post(`/${campaignId.toHexString()}/extend`).send({ days: 3, reason: 'Make-good' }).expect(200);

    expect(updateOne).toHaveBeenCalledWith(
      { _id: campaignId },
      {
        $set: { endDate: new Date('2026-04-13T00:00:00Z'), updatedAt: expect.any(Date) },
        $push: { extensions: { daysAdded: 3, addedBy: 'admin-1', reason: 'Make-good', addedAt: expect.any(Date) } },
      },
    );
    expect(res.body.data.newEndDate).toBe('2026-04-13T00:00:00.000Z');
  });

  test('pauses and unpauses campaigns with advertiser notification on pause', async () => {
    const campaignId = new ObjectId();
    const advertiserId = new ObjectId();
    const updateOne = jest.fn();
    const findOne = jest.fn()
      .mockResolvedValueOnce({ _id: campaignId, advertiserId, status: 'active' })
      .mockResolvedValueOnce({
        _id: campaignId,
        advertiserId,
        status: 'paused',
        pausedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        endDate: new Date('2026-04-20T00:00:00Z'),
      });
    getDb.mockReturnValue(makeDb({ adCampaigns: { findOne, updateOne } }));

    await request(buildApp()).post(`/${campaignId.toHexString()}/pause`).expect(200);
    const unpause = await request(buildApp()).post(`/${campaignId.toHexString()}/unpause`).expect(200);

    expect(updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: campaignId },
      { $set: expect.objectContaining({ status: 'paused' }) },
    );
    expect(notifyAdvertiser).toHaveBeenCalledWith(advertiserId, 'campaign_paused', { adDisplayName: '' });
    expect(updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: campaignId },
      { $set: expect.objectContaining({ status: 'active', endDate: new Date('2026-04-22T00:00:00Z') }) },
    );
    expect(unpause.body.data.pausedDays).toBe(2);
  });

  test('issues full and partial refunds with validation', async () => {
    const campaignId = new ObjectId();
    const submissionId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      adCampaigns: { findOne: jest.fn().mockResolvedValue({ _id: campaignId, submissionId }) },
      adSubmissions: { findOne: jest.fn().mockResolvedValue({ _id: submissionId, paymentIntentId: 'pi_123' }) },
      paymentTransactions: { findOne: jest.fn().mockResolvedValue({ stripePaymentIntentId: 'pi_123', amountInCents: 5000 }) },
    }));

    await request(buildApp()).post(`/${campaignId.toHexString()}/refund`).send({ type: 'weird' }).expect(400);
    const full = await request(buildApp()).post(`/${campaignId.toHexString()}/refund`).send({ type: 'full' }).expect(200);
    const partial = await request(buildApp()).post(`/${campaignId.toHexString()}/refund`).send({ type: 'partial', amountInCents: 1000 }).expect(200);

    expect(stripeService.refund).toHaveBeenCalledWith('pi_123', 'Admin full refund');
    expect(stripeService.partialRefund).toHaveBeenCalledWith('pi_123', 1000, 'Admin partial refund', 'admin-1');
    expect(full.body.data).toEqual({ type: 'full', amountInCents: 5000 });
    expect(partial.body.data).toEqual({ type: 'partial', amountInCents: 1000 });
  });

  test('returns payment details or null when campaign has no payment intent', async () => {
    const campaignId = new ObjectId();
    const submissionId = new ObjectId();
    const transaction = { stripePaymentIntentId: 'pi_123', amountInCents: 5000 };
    const submissionFindOne = jest.fn()
      .mockResolvedValueOnce({ _id: submissionId, paymentIntentId: null })
      .mockResolvedValueOnce({ _id: submissionId, paymentIntentId: 'pi_123' });
    getDb.mockReturnValue(makeDb({
      adCampaigns: { findOne: jest.fn().mockResolvedValue({ _id: campaignId, submissionId }) },
      adSubmissions: { findOne: submissionFindOne },
      paymentTransactions: { findOne: jest.fn().mockResolvedValue(transaction) },
    }));

    await request(buildApp()).get(`/${campaignId.toHexString()}/payment`).expect(200, { message: 'success', data: null });
    const res = await request(buildApp()).get(`/${campaignId.toHexString()}/payment`).expect(200);

    expect(res.body).toEqual({ message: 'success', data: transaction });
  });
});
