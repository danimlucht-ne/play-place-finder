const { getDb } = require('../database');
const pricingService = require('./pricingService');

// Lazy-init Stripe so the server can start without STRIPE_SECRET_KEY set
let _stripe;

function normalizedStripeSecretKey() {
  const raw = process.env.STRIPE_SECRET_KEY;
  if (raw == null) return '';
  let k = String(raw).trim();
  // Strip wrapping quotes from .env editors (e.g. STRIPE_SECRET_KEY="sk_...")
  if (k.length >= 2 && ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'")))) {
    k = k.slice(1, -1).trim();
  }
  return k;
}

function getStripe() {
  if (!_stripe) {
    const key = normalizedStripeSecretKey();
    if (!key) {
      throw new Error(
        'STRIPE_SECRET_KEY is not set or is empty. Add it to server/.env (no spaces around =), restart the API, '
          + 'and ensure you are not relying on a shell-only export.',
      );
    }
    _stripe = require('stripe')(key);
  }
  return _stripe;
}

// Legacy fallback prices — pricingService.getPhasePrice() is the authoritative source
const PACKAGE_PRICES = {
  featured_home: 25000, // $250 — legacy fallback only; pricingService.getPhasePrice is authoritative
  inline_listing: 9900, // $99
  event_spotlight_7d: 2500, // $25 — aligns with growth defaults when derived from $99/mo inline
  event_spotlight_14d: 5000, // $50
  // Prime-surface event spotlight (derived from monthly featured in pricingService)
  event_spotlight_7d_home: 15000,
  event_spotlight_14d_home: 30000,
};
const AUTH_HOLD_DAYS = 7;

function daysUntil(dateLike) {
  const target = new Date(dateLike);
  if (isNaN(target.getTime())) return 0;
  const now = new Date();
  const ms = target.getTime() - now.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function getSubmissionAmountInCents(submission) {
  if (submission?.totalPriceInCents && submission.totalPriceInCents > 0) return submission.totalPriceInCents;
  if (submission?.package?.priceInCents && submission.package.priceInCents > 0) return submission.package.priceInCents;
  return 0;
}

async function getOrCreateStripeCustomer(advertiser) {
  const db = getDb();
  if (advertiser?.stripeCustomerId) return advertiser.stripeCustomerId;
  const customer = await getStripe().customers.create({
    email: advertiser?.contactEmail || undefined,
    name: advertiser?.businessName || undefined,
    metadata: {
      advertiserId: advertiser?._id?.toString?.() || '',
      regionKey: advertiser?.regionKey || '',
    },
  });
  await db.collection('advertisers').updateOne(
    { _id: advertiser._id },
    { $set: { stripeCustomerId: customer.id, updatedAt: new Date() } }
  );
  return customer.id;
}

/**
 * Creates a Stripe PaymentIntent for an ad submission.
 * @param {ObjectId|string} submissionId
 * @param {Object} [discountInfo] — optional discount info to override the amount
 * @param {number} discountInfo.discountedAmountInCents — the discounted price in cents
 * @param {ObjectId|string} discountInfo.discountCodeId — ref to discountCodes._id
 * @param {string} discountInfo.discountCode — the discount code string
 * @param {number} discountInfo.percentOff — the discount percentage
 * @param {number} discountInfo.originalAmountInCents — the original price before discount
 * @returns {Promise<{clientSecret: string, paymentIntentId: string}>}
 */
async function createPaymentIntent(submissionId, discountInfo) {
  const db = getDb();
  const submission = await db.collection('adSubmissions').findOne({ _id: submissionId });
  const advertiser = await db.collection('advertisers').findOne({ _id: submission?.advertiserId });

  if (!submission) {
    throw new Error('Submission not found');
  }
  if (!submission.package) {
    throw new Error(
      'This submission has no saved package (step 2). Open the package step, choose your plan, tap Continue so the server saves it, then return to payment.',
    );
  }

  let amountInCents = getSubmissionAmountInCents(submission);
  if (!amountInCents) {
    // Fall back to phase-aware pricing from pricingService (authoritative source)
    try {
      const pricing = await pricingService.getPhasePrice(advertiser?.regionKey, submission.package.type);
      amountInCents = pricing.priceInCents;
    } catch (_) {}
  }
  if (!amountInCents) amountInCents = PACKAGE_PRICES[submission.package.type];
  if (!amountInCents) {
    throw new Error(`Unknown package type: ${submission.package.type}`);
  }

  // If discount info is provided, use the discounted amount instead
  const finalAmount = discountInfo ? discountInfo.discountedAmountInCents : amountInCents;

  // Build PaymentIntent metadata
  const metadata = {
    submissionId: submissionId.toString(),
    advertiserId: submission.advertiserId.toString(),
    packageType: submission.package.type,
    startDate: submission.startDate ? new Date(submission.startDate).toISOString() : '',
  };

  // Add discount metadata when discount is applied
  if (discountInfo) {
    metadata.discountCode = discountInfo.discountCode;
    metadata.percentOff = String(discountInfo.percentOff);
    metadata.originalAmountInCents = String(discountInfo.originalAmountInCents);
    metadata.discountedAmountInCents = String(discountInfo.discountedAmountInCents);
  }

  const leadDays = submission.startDate ? daysUntil(submission.startDate) : 0;
  const useSetupIntent = leadDays > AUTH_HOLD_DAYS;
  const now = new Date();

  if (useSetupIntent) {
    const customerId = await getOrCreateStripeCustomer(advertiser);
    const setupIntent = await getStripe().setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata,
    });
    if (!setupIntent.client_secret) {
      throw new Error('Stripe SetupIntent did not return a client_secret — check STRIPE_SECRET_KEY and Stripe dashboard API version.');
    }
    const txDoc = {
      submissionId,
      advertiserId: submission.advertiserId,
      stripeSetupIntentId: setupIntent.id,
      amountInCents: finalAmount,
      currency: 'usd',
      status: 'setup_pending',
      createdAt: now,
      updatedAt: now,
    };
    if (discountInfo) Object.assign(txDoc, {
      discountCodeId: discountInfo.discountCodeId,
      discountCode: discountInfo.discountCode,
      percentOff: discountInfo.percentOff,
      originalAmountInCents: discountInfo.originalAmountInCents,
      discountedAmountInCents: discountInfo.discountedAmountInCents,
    });
    await db.collection('paymentTransactions').insertOne(txDoc);
    await db.collection('adSubmissions').updateOne(
      { _id: submissionId },
      {
        $set: {
          paymentIntentId: null,
          setupIntentId: setupIntent.id,
          paymentMode: 'setup_intent',
          paymentStatus: 'setup_pending',
          stripeCustomerId: customerId,
          updatedAt: now,
        },
      }
    );
    return { clientSecret: setupIntent.client_secret, paymentIntentId: '' };
  }

  const paymentIntent = await getStripe().paymentIntents.create({
    amount: finalAmount,
    currency: 'usd',
    capture_method: 'manual',
    // Required on current Stripe API versions so the intent is payable and client_secret is returned.
    automatic_payment_methods: { enabled: true },
    metadata,
  });
  if (!paymentIntent.client_secret) {
    throw new Error('Stripe PaymentIntent did not return a client_secret — check STRIPE_SECRET_KEY and Stripe dashboard.');
  }
  const transactionDoc = {
    submissionId,
    advertiserId: submission.advertiserId,
    stripePaymentIntentId: paymentIntent.id,
    amountInCents: finalAmount,
    currency: 'usd',
    status: 'authorization_pending',
    createdAt: now,
    updatedAt: now,
  };
  if (discountInfo) Object.assign(transactionDoc, {
    discountCodeId: discountInfo.discountCodeId,
    discountCode: discountInfo.discountCode,
    percentOff: discountInfo.percentOff,
    originalAmountInCents: discountInfo.originalAmountInCents,
    discountedAmountInCents: discountInfo.discountedAmountInCents,
  });
  await db.collection('paymentTransactions').insertOne(transactionDoc);
  await db.collection('adSubmissions').updateOne(
    { _id: submissionId },
    {
      $set: {
        paymentIntentId: paymentIntent.id,
        setupIntentId: null,
        paymentMode: 'manual_capture',
        paymentStatus: 'authorization_pending',
        updatedAt: now,
      },
    }
  );
  return { clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id };
}

/**
 * Handles Stripe webhook events.
 * Processes payment_intent.succeeded and payment_intent.payment_failed.
 * @param {Buffer} rawBody — raw request body for signature verification
 * @param {string} signature — Stripe-Signature header
 * @returns {Promise<{handled: boolean, type?: string}>}
 */
async function handleWebhook(rawBody, signature) {
  const db = getDb();
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, endpointSecret);
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }

  const paymentIntent = event.data.object;
  const paymentIntentId = paymentIntent.id;

  if (event.type === 'payment_intent.amount_capturable_updated') {
    await db.collection('paymentTransactions').updateOne(
      { stripePaymentIntentId: paymentIntentId },
      { $set: { status: 'authorized', updatedAt: new Date() } }
    );
    const tx = await db.collection('paymentTransactions').findOne({ stripePaymentIntentId: paymentIntentId });
    if (tx) {
      await db.collection('adSubmissions').updateOne(
        { _id: tx.submissionId },
        { $set: { paymentStatus: 'authorized', updatedAt: new Date() } }
      );
      const adValidationService = require('./adValidationService');
      await adValidationService.runValidation(tx.submissionId);
    }
    return { handled: true, type: event.type };
  }

  if (event.type === 'payment_intent.succeeded') {
    // Idempotency: check if already processed
    const existing = await db.collection('paymentTransactions').findOne({
      stripePaymentIntentId: paymentIntentId,
      status: 'succeeded',
    });
    if (existing) {
      return { handled: true, type: event.type };
    }

    // Update paymentTransaction
    await db.collection('paymentTransactions').updateOne(
      { stripePaymentIntentId: paymentIntentId },
      {
        $set: {
          status: 'succeeded',
          stripeChargeId: paymentIntent.latest_charge || null,
          updatedAt: new Date(),
        },
      }
    );

    // Transition submission to paid and trigger validation
    const transaction = await db.collection('paymentTransactions').findOne({
      stripePaymentIntentId: paymentIntentId,
    });
    if (transaction) {
      const submission = await db.collection('adSubmissions').findOne({ _id: transaction.submissionId });
      await db.collection('adSubmissions').updateOne(
        { _id: transaction.submissionId },
        {
          $set: {
            status: submission?.status === 'approved_pending_charge' ? 'approved' : 'paid',
            paidAt: new Date(),
            paymentStatus: 'captured',
            updatedAt: new Date(),
          },
        }
      );

      // Generate receipt sub-document
      const advertiser = await db.collection('advertisers').findOne({ _id: transaction.advertiserId });
      await db.collection('paymentTransactions').updateOne(
        { _id: transaction._id },
        {
          $set: {
            receipt: {
              businessEntity: 'Lucht Applications LLC',
              appName: 'Play Spotter',
              packageType: submission?.package?.type || '',
              packageDurationDays: submission?.package?.durationDays || 30,
              amountInCents: transaction.amountInCents,
              currency: 'usd',
              advertiserBusinessName: advertiser?.businessName || '',
              advertiserEmail: advertiser?.contactEmail || '',
              paidAt: new Date(),
              receiptNumber: `PPF-${Date.now()}-${transaction._id.toString().slice(-4)}`,
            },
          },
        }
      );

      const campaignLifecycleService = require('./campaignLifecycleService');
      if (submission?.status === 'approved_pending_charge' || submission?.status === 'approved') {
        await campaignLifecycleService.activateCampaign(transaction.submissionId);
      } else {
        const adValidationService = require('./adValidationService');
        await adValidationService.runValidation(transaction.submissionId);
      }

      const { notifyPaymentCapturedIfNeeded } = require('./adCampaignEmailTriggers');
      await notifyPaymentCapturedIfNeeded(transaction.submissionId);
    }

    return { handled: true, type: event.type };
  }

  if (event.type === 'payment_intent.payment_failed') {
    // Idempotency: check if already processed
    const existing = await db.collection('paymentTransactions').findOne({
      stripePaymentIntentId: paymentIntentId,
      status: 'failed',
    });
    if (existing) {
      return { handled: true, type: event.type };
    }

    await db.collection('paymentTransactions').updateOne(
      { stripePaymentIntentId: paymentIntentId },
      { $set: { status: 'failed', updatedAt: new Date() } }
    );

    return { handled: true, type: event.type };
  }

  if (event.type === 'setup_intent.succeeded') {
    const setupIntent = event.data.object;
    const submissionId = setupIntent?.metadata?.submissionId;
    const pmId = setupIntent?.payment_method || null;
    if (submissionId) {
      const { ObjectId } = require('mongodb');
      const sid = ObjectId.isValid(submissionId) ? new ObjectId(submissionId) : submissionId;
      await db.collection('adSubmissions').updateOne(
        { _id: sid },
        {
          $set: {
            paymentStatus: 'payment_method_saved',
            paymentMethodId: pmId,
            updatedAt: new Date(),
          },
        }
      );
      await db.collection('paymentTransactions').updateOne(
        { stripeSetupIntentId: setupIntent.id },
        { $set: { status: 'setup_succeeded', updatedAt: new Date() } }
      );
      const adValidationService = require('./adValidationService');
      await adValidationService.runValidation(sid);
    }
    return { handled: true, type: event.type };
  }

  // Unhandled event type
  return { handled: false, type: event.type };
}

/**
 * Creates a full refund for a rejected submission.
 * @param {string} paymentIntentId — Stripe PaymentIntent ID
 * @param {string} reason — reason for the refund
 * @returns {Promise<{refundId: string}>}
 */
async function refund(paymentIntentId, reason) {
  const db = getDb();

  const refundResult = await getStripe().refunds.create({
    payment_intent: paymentIntentId,
    reason: 'requested_by_customer',
  });

  // Update paymentTransaction with refund info
  await db.collection('paymentTransactions').updateOne(
    { stripePaymentIntentId: paymentIntentId },
    {
      $set: {
        status: 'refunded',
        refundId: refundResult.id,
        refundReason: reason,
        updatedAt: new Date(),
      },
      $push: {
        refundHistory: {
          refundId: refundResult.id,
          amountInCents: refundResult.amount,
          type: 'full',
          reason,
          issuedBy: 'system',
          issuedAt: new Date(),
        },
      },
    }
  );

  return { refundId: refundResult.id };
}

/**
 * Issues a partial Stripe refund for a specific amount.
 * Appends to refundHistory and sets status to partially_refunded.
 * Does NOT modify paymentTransactions if Stripe API errors.
 * @param {string} paymentIntentId
 * @param {number} amountInCents — partial refund amount
 * @param {string} reason
 * @param {string} issuedBy — admin userId or "system"
 * @returns {Promise<{refundId: string}>}
 */
async function partialRefund(paymentIntentId, amountInCents, reason, issuedBy = 'system') {
  const db = getDb();

  const refundResult = await getStripe().refunds.create({
    payment_intent: paymentIntentId,
    amount: amountInCents,
    reason: 'requested_by_customer',
  });

  await db.collection('paymentTransactions').updateOne(
    { stripePaymentIntentId: paymentIntentId },
    {
      $set: {
        status: 'partially_refunded',
        updatedAt: new Date(),
      },
      $push: {
        refundHistory: {
          refundId: refundResult.id,
          amountInCents,
          type: 'partial',
          reason,
          issuedBy,
          issuedAt: new Date(),
        },
      },
    }
  );

  return { refundId: refundResult.id };
}

async function releaseAuthorization(paymentIntentId, reason = 'Submission rejected before capture') {
  const db = getDb();
  if (!paymentIntentId) return;

  const markTxCancelled = () =>
    db.collection('paymentTransactions').updateOne(
      { stripePaymentIntentId: paymentIntentId },
      { $set: { status: 'cancelled', refundReason: reason, updatedAt: new Date() } },
    );

  let pi;
  try {
    pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
  } catch (e) {
    console.warn('[releaseAuthorization] retrieve failed:', e.message);
    return;
  }

  if (pi.status === 'canceled') {
    await markTxCancelled();
    return;
  }
  if (pi.status === 'succeeded') {
    console.warn('[releaseAuthorization] PI already captured; use refund instead:', paymentIntentId);
    return;
  }

  try {
    await getStripe().paymentIntents.cancel(paymentIntentId);
  } catch (e) {
    const code = e.code || '';
    const msg = String(e.message || '');
    const alreadyCanceled =
      (code === 'payment_intent_unexpected_state' && /canceled|cancelled/i.test(msg)) ||
      /cannot cancel.*canceled|status of canceled/i.test(msg);
    if (alreadyCanceled) {
      console.warn('[releaseAuthorization] cancel noop (already canceled):', msg);
    } else {
      throw e;
    }
  }
  await markTxCancelled();
}

async function captureOrChargeSubmission(submission) {
  const db = getDb();
  const tx = await db.collection('paymentTransactions').findOne(
    { submissionId: submission._id },
    { sort: { createdAt: -1 } }
  );
  if (!tx) throw new Error('Missing payment transaction');

  if (submission.paymentMode === 'manual_capture' && submission.paymentIntentId) {
    const pi = await getStripe().paymentIntents.capture(submission.paymentIntentId);
    if (pi.status !== 'succeeded') throw new Error(`Capture failed: ${pi.status}`);
    return { mode: 'manual_capture', paymentIntentId: pi.id };
  }

  if (submission.paymentMode === 'setup_intent') {
    if (!submission.paymentMethodId) throw new Error('No saved payment method');
    const amountInCents = tx.amountInCents || getSubmissionAmountInCents(submission);
    const paymentIntent = await getStripe().paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      customer: submission.stripeCustomerId || undefined,
      payment_method: submission.paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        submissionId: submission._id.toString(),
        advertiserId: submission.advertiserId.toString(),
        packageType: submission.package?.type || '',
      },
    });
    await db.collection('paymentTransactions').insertOne({
      submissionId: submission._id,
      advertiserId: submission.advertiserId,
      stripePaymentIntentId: paymentIntent.id,
      amountInCents,
      currency: 'usd',
      status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('adSubmissions').updateOne(
      { _id: submission._id },
      { $set: { paymentIntentId: paymentIntent.id, paymentStatus: paymentIntent.status, updatedAt: new Date() } }
    );
    if (paymentIntent.status !== 'succeeded') throw new Error(`Charge failed: ${paymentIntent.status}`);
    return { mode: 'setup_intent', paymentIntentId: paymentIntent.id };
  }

  throw new Error(`Unsupported paymentMode: ${submission.paymentMode || 'unknown'}`);
}

/**
 * When PaymentSheet completes but webhooks didn’t run (local dev), sync Stripe state and run validation once.
 * - manual_capture: capture authorized PaymentIntent if needed, then validate.
 * - setup_intent: campaign start beyond minimum lead — PaymentSheet completes a SetupIntent; validate after it succeeds.
 */
async function reconcileSubmissionAfterCheckout(submissionId) {
  const db = getDb();
  const { ObjectId } = require('mongodb');
  const adValidationService = require('./adValidationService');
  const sid = ObjectId.isValid(String(submissionId)) ? new ObjectId(String(submissionId)) : submissionId;
  let submission = await db.collection('adSubmissions').findOne({ _id: sid });
  if (!submission) {
    throw new Error('Submission not found');
  }

  if (submission.paymentMode === 'setup_intent' && submission.setupIntentId) {
    const si = await getStripe().setupIntents.retrieve(submission.setupIntentId);
    if (si.status === 'succeeded') {
      const pmId = typeof si.payment_method === 'string'
        ? si.payment_method
        : (si.payment_method && si.payment_method.id) || null;
      await db.collection('adSubmissions').updateOne(
        { _id: sid },
        {
          $set: {
            paymentStatus: 'payment_method_saved',
            ...(pmId ? { paymentMethodId: pmId } : {}),
            updatedAt: new Date(),
          },
        },
      );
      await db.collection('paymentTransactions').updateOne(
        { stripeSetupIntentId: submission.setupIntentId },
        { $set: { status: 'setup_succeeded', updatedAt: new Date() } },
      );
      submission = await db.collection('adSubmissions').findOne({ _id: sid });
      if (!submission.validationResult?.checkedAt) {
        await adValidationService.runValidation(sid);
      }
      return { ok: true, skipped: false, setupIntentStatus: si.status };
    }
    return { ok: true, skipped: true, setupIntentStatus: si.status };
  }

  if (submission.paymentMode !== 'manual_capture' || !submission.paymentIntentId) {
    return { ok: true, skipped: true };
  }

  const pi = await getStripe().paymentIntents.retrieve(submission.paymentIntentId);

  if (pi.status === 'requires_capture') {
    await captureOrChargeSubmission(submission);
    await db.collection('paymentTransactions').updateOne(
      { submissionId: sid, stripePaymentIntentId: submission.paymentIntentId },
      { $set: { status: 'succeeded', updatedAt: new Date() } },
    );
    submission = await db.collection('adSubmissions').findOne({ _id: sid });
    const { notifyPaymentCapturedIfNeeded } = require('./adCampaignEmailTriggers');
    await notifyPaymentCapturedIfNeeded(sid);
  }

  if (!submission.validationResult?.checkedAt) {
    await adValidationService.runValidation(sid);
  }

  return { ok: true, skipped: false, piStatus: pi.status };
}

module.exports = {
  createPaymentIntent,
  handleWebhook,
  refund,
  partialRefund,
  releaseAuthorization,
  captureOrChargeSubmission,
  reconcileSubmissionAfterCheckout,
  PACKAGE_PRICES,
};
