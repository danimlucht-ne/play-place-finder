const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { ObjectId } = require('mongodb');
const { verifyAdminToken } = require('../services/authService');
const { isDevDiscountEnvironment } = require('../utils/devDiscountEnvironment');

// --- Admin CRUD endpoints (mounted at /admin/ads/discounts) ---

// POST / — create discount code
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    const db = getDb();
    const {
      code,
      percentOff,
      startDate,
      endDate,
      maxUses,
      regionKey: regionKeyRaw,
      advertiserId: advertiserIdRaw,
      devOnly: devOnlyRaw,
      unlimitedValidity: unlimitedRaw,
    } = req.body;

    // Validate required fields
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return res.status(400).json({ error: 'code is required' });
    }

    if (percentOff === undefined || percentOff === null || percentOff < 1 || percentOff > 100) {
      return res.status(400).json({ error: 'percentOff must be between 1 and 100' });
    }

    const devOnly = !!devOnlyRaw;
    if (devOnly && !isDevDiscountEnvironment()) {
      return res.status(403).json({ error: 'Dev-only discount codes are not allowed in this environment' });
    }

    const unlimitedValidity = !!unlimitedRaw && devOnly;
    if (unlimitedRaw && !devOnly) {
      return res.status(400).json({ error: 'unlimitedValidity is only allowed together with devOnly' });
    }

    let start;
    let end;
    if (unlimitedValidity) {
      start = new Date('2000-01-01T00:00:00.000Z');
      end = new Date('2100-01-01T00:00:00.000Z');
    } else {
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required (or use devOnly + unlimitedValidity)' });
      }
      start = new Date(startDate);
      end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: 'startDate and endDate must be valid dates' });
      }
      if (end <= start) {
        return res.status(400).json({ error: 'endDate must be after startDate' });
      }
    }

    let regionKey = null;
    if (regionKeyRaw != null && String(regionKeyRaw).trim()) {
      regionKey = String(regionKeyRaw).trim().toLowerCase().replace(/_/g, '-');
    }

    let advertiserId = null;
    if (advertiserIdRaw != null && String(advertiserIdRaw).trim()) {
      const aid = String(advertiserIdRaw).trim();
      if (!ObjectId.isValid(aid)) {
        return res.status(400).json({ error: 'advertiserId must be a valid ObjectId when provided' });
      }
      advertiserId = new ObjectId(aid);
      const adv = await db.collection('advertisers').findOne({ _id: advertiserId });
      if (!adv) {
        return res.status(400).json({ error: 'advertiserId not found' });
      }
    }

    // Check for duplicate code (case-insensitive)
    const existing = await db.collection('discountCodes').findOne(
      { code: code.trim() },
      { collation: { locale: 'en', strength: 2 } }
    );

    if (existing) {
      return res.status(409).json({ error: 'A discount code with this name already exists' });
    }

    const now = new Date();
    const doc = {
      code: code.trim(),
      percentOff: Math.floor(percentOff),
      startDate: start,
      endDate: end,
      maxUses: maxUses && maxUses > 0 ? Math.floor(maxUses) : 0,
      usageCount: 0,
      createdBy: req.user.uid,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    if (regionKey) doc.regionKey = regionKey;
    if (advertiserId) doc.advertiserId = advertiserId;
    if (devOnly) doc.devOnly = true;
    if (unlimitedValidity) doc.unlimitedValidity = true;

    const result = await db.collection('discountCodes').insertOne(doc);
    doc._id = result.insertedId;

    res.status(201).json({ message: 'success', data: doc });
  } catch (err) {
    // Handle MongoDB duplicate key error (race condition fallback)
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A discount code with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});


// GET / — list all discount codes sorted by createdAt descending
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    const db = getDb();
    const codes = await db.collection('discountCodes')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ message: 'success', data: codes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — update discount code fields
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getDb();
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid discount code ID' });
    }

    const { percentOff, startDate, endDate, maxUses, active } = req.body;
    const updateFields = {};

    if (percentOff !== undefined) {
      if (percentOff < 1 || percentOff > 100) {
        return res.status(400).json({ error: 'percentOff must be between 1 and 100' });
      }
      updateFields.percentOff = Math.floor(percentOff);
    }

    if (startDate !== undefined) {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) {
        return res.status(400).json({ error: 'startDate must be a valid date' });
      }
      updateFields.startDate = start;
    }

    if (endDate !== undefined) {
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        return res.status(400).json({ error: 'endDate must be a valid date' });
      }
      updateFields.endDate = end;
    }

    // Validate endDate > startDate if both are being set or one is changing
    if (updateFields.startDate || updateFields.endDate) {
      const existing = await db.collection('discountCodes').findOne({ _id: new ObjectId(id) });
      if (!existing) {
        return res.status(404).json({ error: 'Discount code not found' });
      }
      const effectiveStart = updateFields.startDate || existing.startDate;
      const effectiveEnd = updateFields.endDate || existing.endDate;
      if (effectiveEnd <= effectiveStart) {
        return res.status(400).json({ error: 'endDate must be after startDate' });
      }
    }

    if (maxUses !== undefined) {
      updateFields.maxUses = maxUses > 0 ? Math.floor(maxUses) : 0;
    }

    if (active !== undefined) {
      updateFields.active = !!active;
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updateFields.updatedAt = new Date();

    const result = await db.collection('discountCodes').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Discount code not found' });
    }

    res.json({ message: 'success', data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — soft-delete: set active=false
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getDb();
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid discount code ID' });
    }

    const now = new Date();
    const result = await db.collection('discountCodes').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { active: false, updatedAt: now } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Discount code not found' });
    }

    res.json({ message: 'success', data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id/redemptions — return redemption history sorted by redeemedAt descending
router.get('/:id/redemptions', verifyAdminToken, async (req, res) => {
  try {
    const db = getDb();
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid discount code ID' });
    }

    const redemptions = await db.collection('discountRedemptions')
      .find({ discountCodeId: new ObjectId(id) })
      .sort({ redeemedAt: -1 })
      .toArray();

    res.json({ message: 'success', data: redemptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Public validate endpoint (mounted at /api/ads/discounts) ---

const validateRouter = express.Router();
const { assertDiscountApplicable } = require('../services/discountCodeRules');

// POST /validate — validate a discount code for a submission
validateRouter.post('/validate', async (req, res) => {
  try {
    const db = getDb();
    const { code, submissionId } = req.body;

    if (!code || !submissionId) {
      return res.status(400).json({ error: 'code and submissionId are required' });
    }
    if (!ObjectId.isValid(submissionId)) {
      return res.status(400).json({ error: 'Invalid submission ID' });
    }

    // Case-insensitive lookup
    const discountCode = await db.collection('discountCodes').findOne(
      { code: code.trim() },
      { collation: { locale: 'en', strength: 2 } }
    );

    if (!discountCode) {
      return res.status(404).json({ error: 'Invalid discount code' });
    }

    const submission = await db.collection('adSubmissions').findOne(
      { _id: new ObjectId(submissionId) }
    );

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const advertiser = submission.advertiserId
      ? await db.collection('advertisers').findOne({ _id: submission.advertiserId })
      : null;

    try {
      assertDiscountApplicable(discountCode, submission, advertiser, new Date());
    } catch (e) {
      const status = e.statusCode || 400;
      return res.status(status).json({ error: e.message });
    }

    const percentOff = Number(discountCode.percentOff) || 0;

    const pkg = submission.package || {};
    const originalAmountInCents = submission.totalPriceInCents && submission.totalPriceInCents > 0
      ? submission.totalPriceInCents
      : (pkg.priceInCents || 0);
    if (!originalAmountInCents) {
      return res.status(400).json({ error: 'Order total is not available yet; finish package selection and try again' });
    }

    const discountedAmountInCents = Math.floor(originalAmountInCents * (100 - percentOff) / 100);

    res.json({
      message: 'success',
      data: {
        percentOff,
        originalAmountInCents,
        discountedAmountInCents,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { adminRouter: router, validateRouter };
