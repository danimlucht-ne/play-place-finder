const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const stripeService = require('../services/stripeService');
const adValidationService = require('../services/adValidationService');
const { assertDiscountApplicable } = require('../services/discountCodeRules');

/** Unique value for free checkouts — never use null here: { unique: true } on stripePaymentIntentId treats all nulls as one key. */
function freeCheckoutStripePlaceholder(submissionObjectId) {
  const oid = submissionObjectId instanceof ObjectId ? submissionObjectId : new ObjectId(String(submissionObjectId));
  return `free_submission:${oid.toHexString()}`;
}

/** Match legacy docs that stored submissionId as ObjectId or hex string. */
function submissionIdEqFilter(submissionObjectId) {
  const oid = submissionObjectId instanceof ObjectId ? submissionObjectId : new ObjectId(String(submissionObjectId));
  return { $or: [{ submissionId: oid }, { submissionId: oid.toHexString() }] };
}

/**
 * Validates a discount code server-side.
 * Returns the discount code document and calculated amounts, or throws with a descriptive error.
 */
async function validateDiscountCode(db, code, submissionId) {
  if (!ObjectId.isValid(submissionId)) {
    const err = new Error('Invalid submission ID');
    err.statusCode = 400;
    throw err;
  }

  const discountCode = await db.collection('discountCodes').findOne(
    { code: code.trim() },
    { collation: { locale: 'en', strength: 2 } }
  );

  if (!discountCode) {
    const err = new Error('Invalid discount code');
    err.statusCode = 404;
    throw err;
  }

  const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(submissionId) });
  if (!submission) {
    const err = new Error('Submission not found');
    err.statusCode = 404;
    throw err;
  }

  const advertiser = submission.advertiserId
    ? await db.collection('advertisers').findOne({ _id: submission.advertiserId })
    : null;

  assertDiscountApplicable(discountCode, submission, advertiser, new Date());

  const percentOff = Number(discountCode.percentOff) || 0;

  const pkg = submission.package || {};
  const originalAmountInCents = submission.totalPriceInCents && submission.totalPriceInCents > 0
    ? submission.totalPriceInCents
    : (pkg.priceInCents || 0);
  if (!originalAmountInCents) {
    const err = new Error('Order total is not available yet; finish package selection and try again');
    err.statusCode = 400;
    throw err;
  }
  const discountedAmountInCents = Math.floor(originalAmountInCents * (100 - percentOff) / 100);

  return { discountCode, submission, originalAmountInCents, discountedAmountInCents };
}

/**
 * Records discount side effects: increment usageCount, create redemption, update submission.
 */
async function recordDiscountRedemption(db, discountCode, submission, originalAmountInCents, discountedAmountInCents) {
  // Increment usageCount on the discount code
  await db.collection('discountCodes').updateOne(
    { _id: discountCode._id },
    { $inc: { usageCount: 1 }, $set: { updatedAt: new Date() } }
  );

  // Create discountRedemption entry
  await db.collection('discountRedemptions').insertOne({
    discountCodeId: discountCode._id,
    code: discountCode.code,
    submissionId: submission._id,
    advertiserId: submission.advertiserId,
    userId: submission.userId || '',
    percentOff: discountCode.percentOff,
    originalAmountInCents,
    discountedAmountInCents,
    redeemedAt: new Date(),
  });

  // Update adSubmissions with discount fields
  await db.collection('adSubmissions').updateOne(
    { _id: submission._id },
    {
      $set: {
        discountCodeId: discountCode._id,
        discountCode: discountCode.code,
        percentOff: discountCode.percentOff,
        originalAmountInCents,
        discountedAmountInCents,
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * After validateDiscountCode + 100% checks: record redemption if needed, ensure $0 tx, mark paid, run validation.
 * Idempotent for retries and concurrent double-clicks (duplicate redemption insert → recover in route catch).
 */
async function applyFreeSubmissionCheckout(db, { discountCodeDoc, submission, originalAmountInCents }) {
  const subId = submission._id;
  const requestedCodeNorm = String(discountCodeDoc.code || '').trim().toLowerCase();

  const subNow = await db.collection('adSubmissions').findOne({ _id: subId });
  const succeededTx = await db.collection('paymentTransactions').findOne({
    status: 'succeeded',
    ...submissionIdEqFilter(subId),
  });
  if (subNow?.status === 'paid' && succeededTx) {
    return;
  }

  const existingRedemption = await db.collection('discountRedemptions').findOne(submissionIdEqFilter(subId));
  if (existingRedemption) {
    const appliedNorm = String(existingRedemption.code || '').trim().toLowerCase();
    if (appliedNorm !== requestedCodeNorm) {
      const e = new Error('A different discount code has already been applied to this submission');
      e.statusCode = 400;
      throw e;
    }
  } else {
    await recordDiscountRedemption(
      db,
      discountCodeDoc,
      submission,
      originalAmountInCents,
      0,
    );
  }

  if (!succeededTx) {
    await db.collection('paymentTransactions').insertOne({
      submissionId: subId,
      advertiserId: submission.advertiserId,
      stripePaymentIntentId: freeCheckoutStripePlaceholder(subId),
      amountInCents: 0,
      currency: 'usd',
      status: 'succeeded',
      discountCodeId: discountCodeDoc._id,
      discountCode: discountCodeDoc.code,
      percentOff: discountCodeDoc.percentOff,
      originalAmountInCents,
      discountedAmountInCents: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const paidAt = subNow?.status === 'paid' && subNow.paidAt ? subNow.paidAt : new Date();
  await db.collection('adSubmissions').updateOne(
    { _id: subId },
    {
      $set: {
        status: 'paid',
        paidAt,
        updatedAt: new Date(),
      },
    },
  );

  await adValidationService.runValidation(subId);
}

// POST /reconcile/:submissionId — capture + validate when webhooks missed (e.g. local dev)
router.post('/reconcile/:submissionId', async (req, res) => {
  try {
    const db = getDb();
    if (!ObjectId.isValid(req.params.submissionId)) {
      return res.status(400).json({ error: 'Invalid submission ID' });
    }
    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.submissionId) });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });
    if (!advertiser || advertiser.userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await stripeService.reconcileSubmissionAfterCheckout(req.params.submissionId);
    res.json({ message: 'success', data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /create-intent — create Stripe PaymentIntent (with optional discount code support)
router.post('/create-intent', async (req, res) => {
  try {
    const { submissionId, discountCode } = req.body;
    if (!submissionId) {
      return res.status(400).json({ error: 'submissionId is required' });
    }
    if (!ObjectId.isValid(submissionId)) {
      return res.status(400).json({ error: 'Invalid submission ID' });
    }

    const db = getDb();
    let discountInfo = null;
    let discountCodeDoc = null;
    let submission = null;
    let originalAmountInCents = null;
    let discountedAmountInCents = null;

    // If a discount code is provided, re-validate server-side
    if (discountCode) {
      const validation = await validateDiscountCode(db, discountCode, submissionId);
      discountCodeDoc = validation.discountCode;
      submission = validation.submission;
      originalAmountInCents = validation.originalAmountInCents;
      discountedAmountInCents = validation.discountedAmountInCents;

      discountInfo = {
        discountedAmountInCents,
        discountCodeId: discountCodeDoc._id,
        discountCode: discountCodeDoc.code,
        percentOff: discountCodeDoc.percentOff,
        originalAmountInCents,
      };
      if (discountedAmountInCents === 0) {
        const po = Number(discountCodeDoc.percentOff) || 0;
        if (originalAmountInCents <= 0 || po !== 100) {
          return res.status(400).json({
            error: 'A zero-dollar total requires a valid 100% off code and a positive order total. Re-check your package or discount.',
          });
        }
        // Stripe cannot create a $0 PaymentIntent — client completes via POST /free-submission
        return res.status(200).json({
          message: 'success',
          data: {
            clientSecret: '',
            paymentIntentId: '',
            freeCheckout: true,
          },
        });
      }
    }

    const result = await stripeService.createPaymentIntent(new ObjectId(submissionId), discountInfo);

    // Record discount side effects after successful payment intent creation
    if (discountCodeDoc && submission) {
      await recordDiscountRedemption(db, discountCodeDoc, submission, originalAmountInCents, discountedAmountInCents);
    }

    res.json({ message: 'success', data: result });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /free-submission — handle 100% discount submissions without Stripe
router.post('/free-submission', async (req, res) => {
  try {
    const { submissionId, discountCode } = req.body;
    if (!submissionId || !discountCode) {
      return res.status(400).json({ error: 'submissionId and discountCode are required' });
    }

    const db = getDb();

    // Re-validate discount code server-side
    const validation = await validateDiscountCode(db, discountCode, submissionId);
    const { discountCode: discountCodeDoc, submission, originalAmountInCents, discountedAmountInCents } = validation;

    // Confirm true 100% discount (not a $0 order or 0% code)
    if (discountedAmountInCents !== 0 || originalAmountInCents <= 0) {
      return res.status(400).json({ error: 'Discount does not cover full amount' });
    }
    if (Number(discountCodeDoc.percentOff) !== 100) {
      return res.status(400).json({ error: 'Free checkout requires a 100% off discount code' });
    }

    await applyFreeSubmissionCheckout(db, {
      discountCodeDoc,
      submission,
      originalAmountInCents,
    });

    res.json({ message: 'success' });
  } catch (err) {
    if (err.code === 11000) {
      const dupKey = err.keyPattern && Object.keys(err.keyPattern)[0];
      const dupMsg = String(err.message || '');
      const dupSubmission =
        dupKey === 'submissionId' || /index:\s*submissionId_\d+|dup key.*submissionId/i.test(dupMsg);
      const dupStripe =
        dupKey === 'stripePaymentIntentId' ||
        /index:\s*stripePaymentIntentId_\d+|dup key.*stripePaymentIntentId/i.test(dupMsg);
      // Duplicate redemption row (double-click) or duplicate synthetic Stripe id (retry) — finish checkout idempotently.
      if (req.body.submissionId && req.body.discountCode && (dupSubmission || dupStripe)) {
        try {
          const db = getDb();
          const v = await validateDiscountCode(db, req.body.discountCode, req.body.submissionId);
          if (v.discountedAmountInCents !== 0 || v.originalAmountInCents <= 0) {
            return res.status(400).json({ error: 'Discount does not cover full amount' });
          }
          if (Number(v.discountCode.percentOff) !== 100) {
            return res.status(400).json({ error: 'Free checkout requires a 100% off discount code' });
          }
          await applyFreeSubmissionCheckout(db, {
            discountCodeDoc: v.discountCode,
            submission: v.submission,
            originalAmountInCents: v.originalAmountInCents,
          });
          return res.json({ message: 'success' });
        } catch (recoveryErr) {
          const st = recoveryErr.statusCode || 500;
          if (st >= 400 && st < 500) {
            return res.status(st).json({ error: recoveryErr.message });
          }
          console.warn('[free-submission] E11000 recovery failed:', recoveryErr.message);
        }
      }
      if (dupStripe) {
        return res.status(409).json({
          error:
            'A payment record already exists for this checkout (often a retry after a slow response). Pull to refresh; if it persists, contact support.',
        });
      }
      return res.status(400).json({ error: 'A discount code has already been applied to this submission' });
    }
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /webhook — Stripe webhook handler (expects raw body)
// NOTE: This route must be mounted with express.raw() body parser, NOT JSON.
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing Stripe-Signature header' });
    }

    const result = await stripeService.handleWebhook(req.body, signature);
    res.json({ received: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /receipt/:submissionId — fetch receipt for a succeeded payment
router.get('/receipt/:submissionId', async (req, res) => {
  try {
    const db = getDb();
    if (!ObjectId.isValid(req.params.submissionId)) {
      return res.status(400).json({ error: 'Invalid submission ID' });
    }
    const transaction = await db.collection('paymentTransactions').findOne({
      submissionId: new ObjectId(req.params.submissionId),
      status: 'succeeded',
    });
    if (!transaction || !transaction.receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    // Verify ownership: submission → advertiser → check userId
    const submission = await db.collection('adSubmissions').findOne({ _id: transaction.submissionId });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });
    if (!advertiser || advertiser.userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ message: 'success', data: transaction.receipt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
