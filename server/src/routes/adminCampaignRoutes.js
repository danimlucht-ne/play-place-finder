const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { ObjectId } = require('mongodb');
const { verifyAdminToken } = require('../services/authService');
const refundCalculator = require('../services/refundCalculator');
const stripeService = require('../services/stripeService');
const cityPhaseService = require('../services/cityPhaseService');
const { notifyAdvertiser, resolveAdDisplayName } = require('../services/advertiserEmailService');

router.use(verifyAdminToken);

// GET / — list all campaigns with filters, sort, pagination
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { status, cityId, sort = 'createdAt', order = 'desc', page = '1', limit = '20' } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (cityId) filter.cityId = cityId;

    const sortField = ['startDate', 'endDate', 'createdAt'].includes(sort) ? sort : 'createdAt';
    const sortDir = order === 'asc' ? 1 : -1;
    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const lim = Math.min(100, Math.max(1, parseInt(limit)));

    const [campaigns, total] = await Promise.all([
      db.collection('adCampaigns').find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(lim).toArray(),
      db.collection('adCampaigns').countDocuments(filter),
    ]);

    // Enrich with advertiser + creative info
    const enriched = await Promise.all(campaigns.map(async (c) => {
      const advertiser = await db.collection('advertisers').findOne({ _id: c.advertiserId });
      const creative = c.creativeId ? await db.collection('adCreatives').findOne({ _id: c.creativeId }) : null;
      return {
        ...c,
        businessName: (creative?.businessName && String(creative.businessName).trim())
          || advertiser?.businessName
          || '',
        headline: creative?.headline || '',
      };
    }));

    res.json({ message: 'success', data: enriched, total, page: parseInt(page), limit: lim });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/cancel — admin cancel with reason + pro-rated refund
router.post('/:id/cancel', async (req, res) => {
  try {
    const db = getDb();
    const campaign = await db.collection('adCampaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!['active', 'scheduled'].includes(campaign.status)) {
      return res.status(400).json({ error: 'Campaign cannot be cancelled in its current status' });
    }

    const { reason } = req.body;
    const now = new Date();

    // Pro-rated refund
    const submission = await db.collection('adSubmissions').findOne({ _id: campaign.submissionId });
    let refundAmountInCents = 0;
    if (submission?.paymentIntentId) {
      const transaction = await db.collection('paymentTransactions').findOne({ stripePaymentIntentId: submission.paymentIntentId });
      if (transaction && transaction.amountInCents > 0) {
        const info = refundCalculator.calculateProRatedRefund(campaign.startDate, campaign.endDate, transaction.amountInCents);
        refundAmountInCents = info.refundAmountInCents;
        if (refundAmountInCents > 0) {
          try {
            await stripeService.partialRefund(submission.paymentIntentId, refundAmountInCents, reason || 'Admin cancellation', req.user.uid);
          } catch (err) { console.warn('[adminCampaign] Refund failed:', err.message); }
        }
      }
    }

    await db.collection('adCampaigns').updateOne({ _id: campaign._id }, {
      $set: { status: 'cancelled', cancelledAt: now, cancelledBy: req.user.uid, cancellationReason: reason || null, updatedAt: now },
    });
    await db.collection('adSubmissions').updateOne({ _id: campaign.submissionId }, { $set: { status: 'cancelled', updatedAt: now } });
    await db.collection('adTargeting').deleteMany({ campaignId: campaign._id });

    const regionKeys = campaign.targetedRegionKeys || [campaign.cityId];
    const slotType = campaign.placement === 'featured_home' ? 'featured' : 'sponsored';
    for (const rk of regionKeys) { try { await cityPhaseService.incrementSlot(rk, slotType); } catch (_) {} }

    // Notify advertiser of cancellation
    const adDisplayName = await resolveAdDisplayName(db, campaign.creativeId);
    notifyAdvertiser(campaign.advertiserId, 'campaign_cancelled', { refundAmount: refundAmountInCents, adDisplayName });

    res.json({ message: 'success', data: { cancelled: true, refundAmountInCents } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/extend — extend campaign duration by N days
router.post('/:id/extend', async (req, res) => {
  try {
    const db = getDb();
    const campaign = await db.collection('adCampaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!['active', 'scheduled'].includes(campaign.status)) {
      return res.status(400).json({ error: 'Campaign cannot be extended in its current status' });
    }

    const { days, reason } = req.body;
    if (!days || days < 1 || days > 90) return res.status(400).json({ error: 'Extension must be between 1 and 90 days' });

    const newEndDate = new Date(campaign.endDate);
    newEndDate.setDate(newEndDate.getDate() + days);

    await db.collection('adCampaigns').updateOne({ _id: campaign._id }, {
      $set: { endDate: newEndDate, updatedAt: new Date() },
      $push: { extensions: { daysAdded: days, addedBy: req.user.uid, reason: reason || null, addedAt: new Date() } },
    });

    res.json({ message: 'success', data: { newEndDate } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/pause — pause an active campaign
router.post('/:id/pause', async (req, res) => {
  try {
    const db = getDb();
    const campaign = await db.collection('adCampaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'active') return res.status(400).json({ error: 'Only active campaigns can be paused' });

    await db.collection('adCampaigns').updateOne({ _id: campaign._id }, {
      $set: { status: 'paused', pausedAt: new Date(), updatedAt: new Date() },
    });

    // Notify advertiser of pause
    const adDisplayName = await resolveAdDisplayName(db, campaign.creativeId);
    notifyAdvertiser(campaign.advertiserId, 'campaign_paused', { adDisplayName });

    res.json({ message: 'success' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/unpause — unpause a paused campaign, extend endDate by paused duration
router.post('/:id/unpause', async (req, res) => {
  try {
    const db = getDb();
    const campaign = await db.collection('adCampaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'paused') return res.status(400).json({ error: 'Only paused campaigns can be unpaused' });

    const now = new Date();
    const pausedMs = now.getTime() - (campaign.pausedAt ? campaign.pausedAt.getTime() : now.getTime());
    const pausedDays = Math.ceil(pausedMs / (24 * 60 * 60 * 1000));
    const newEndDate = new Date(campaign.endDate);
    newEndDate.setDate(newEndDate.getDate() + pausedDays);

    await db.collection('adCampaigns').updateOne({ _id: campaign._id }, {
      $set: { status: 'active', unpausedAt: now, endDate: newEndDate, updatedAt: now },
    });
    res.json({ message: 'success', data: { newEndDate, pausedDays } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/refund — issue full or partial refund
router.post('/:id/refund', async (req, res) => {
  try {
    const db = getDb();
    const campaign = await db.collection('adCampaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { type, amountInCents, reason } = req.body;
    if (!type || !['full', 'partial'].includes(type)) {
      return res.status(400).json({ error: 'type must be full or partial' });
    }

    const submission = await db.collection('adSubmissions').findOne({ _id: campaign.submissionId });
    if (!submission?.paymentIntentId) return res.status(400).json({ error: 'No payment found for this campaign' });

    const transaction = await db.collection('paymentTransactions').findOne({ stripePaymentIntentId: submission.paymentIntentId });
    if (!transaction) return res.status(400).json({ error: 'Payment transaction not found' });

    if (type === 'full') {
      await stripeService.refund(submission.paymentIntentId, reason || 'Admin full refund');
      res.json({ message: 'success', data: { type: 'full', amountInCents: transaction.amountInCents } });
    } else {
      if (!amountInCents || amountInCents <= 0) return res.status(400).json({ error: 'amountInCents is required for partial refunds' });
      if (amountInCents > transaction.amountInCents) return res.status(400).json({ error: 'Refund amount exceeds original payment amount' });
      await stripeService.partialRefund(submission.paymentIntentId, amountInCents, reason || 'Admin partial refund', req.user.uid);
      res.json({ message: 'success', data: { type: 'partial', amountInCents } });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:id/payment — get payment details with refund history
router.get('/:id/payment', async (req, res) => {
  try {
    const db = getDb();
    const campaign = await db.collection('adCampaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const submission = await db.collection('adSubmissions').findOne({ _id: campaign.submissionId });
    if (!submission?.paymentIntentId) return res.json({ message: 'success', data: null });

    const transaction = await db.collection('paymentTransactions').findOne({ stripePaymentIntentId: submission.paymentIntentId });
    res.json({ message: 'success', data: transaction });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
