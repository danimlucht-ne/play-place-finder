const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { Storage } = require('@google-cloud/storage');
const axios = require('axios');
const cityPhaseService = require('../services/cityPhaseService');
const pricingService = require('../services/pricingService');
const radiusTargetingService = require('../services/radiusTargetingService');
const stripeService = require('../services/stripeService');
const adTrackingService = require('../services/adTrackingService');

/**
 * Geocodes a street address to lat/lng using Google Geocoding API.
 * Returns { lat, lng } or null if geocoding fails.
 */
async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address, key: apiKey },
    });
    if (response.data.results && response.data.results.length > 0) {
      const loc = response.data.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng };
    }
  } catch (_) { /* geocoding failure is non-fatal */ }
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

const storage = new Storage(
  process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? { keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS }
    : {}
);
const bucket = storage.bucket('playground_app_bucket');

const ALLOWED_CATEGORIES = [
  'indoor_play', 'outdoor_recreation', 'family_dining', 'education',
  'entertainment', 'retail', 'health_wellness', 'services', 'other',
];

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const HTML_REGEX = /<[^>]*>/;

function hasHtml(str) {
  return HTML_REGEX.test(str);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// GET /radius-preview — preview reachable cities at each radius tier
router.get('/radius-preview', async (req, res) => {
  try {
    const db = getDb();
    const { city, state, regionKey: regionKeyParam } = req.query;
    let regionKey;
    if (regionKeyParam && typeof regionKeyParam === 'string' && regionKeyParam.trim()) {
      regionKey = regionKeyParam.trim().toLowerCase();
    } else if (city && state) {
      regionKey = `${String(city).toLowerCase().replace(/\s+/g, '-')}-${String(state).toLowerCase()}`;
    } else {
      return res.status(400).json({ error: 'Provide regionKey or both city and state query params' });
    }
    const region = await db.collection('seeded_regions').findOne({ regionKey });
    if (!region || !region.center) {
      return res.status(400).json({ error: 'Business location could not be resolved. Please verify your city and state.' });
    }

    const advertiser = await db.collection('advertisers').findOne({ userId: req.user.uid });
    if (!advertiser) {
      return res.status(403).json({ error: 'Advertiser profile required' });
    }
    if (String(advertiser.regionKey || '').toLowerCase() !== regionKey) {
      return res.status(400).json({ error: 'regionKey does not match your advertiser profile' });
    }
    const origin =
      Number.isFinite(advertiser.businessLat) && Number.isFinite(advertiser.businessLng)
        ? { lat: advertiser.businessLat, lng: advertiser.businessLng }
        : null;
    const data = await radiusTargetingService.getRadiusPreview(regionKey, origin);
    res.json({ message: 'success', data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:id/creative — get the creative linked to a submission
router.get('/:id/creative', async (req, res) => {
  try {
    const db = getDb();
    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.id) });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });
    if (!advertiser || advertiser.userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!submission.creativeId) {
      return res.status(404).json({ error: 'No creative linked to this submission' });
    }

    const creative = await db.collection('adCreatives').findOne({ _id: submission.creativeId });
    if (!creative) {
      return res.status(404).json({ error: 'Creative not found' });
    }

    res.json({ message: 'success', data: creative });
  } catch (err) {
    console.error('[adSubmission/get-creative]', req.id, err.message);
    res.status(500).json({ error: err.message, requestId: req.id });
  }
});

// GET /mine — list advertiser's own submissions
router.get('/mine', async (req, res) => {
  try {
    const db = getDb();
    const advertiser = await db.collection('advertisers').findOne({ userId: req.user.uid });
    if (!advertiser) return res.json({ message: 'success', data: [] });

    const submissions = await db.collection('adSubmissions')
      .find({ advertiserId: advertiser._id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ message: 'success', data: submissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/prelaunch-cancel — cancel before campaign launch/payment capture
router.post('/:id/prelaunch-cancel', async (req, res) => {
  try {
    const db = getDb();
    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.id) });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });
    if (!advertiser || advertiser.userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const campaign = await db.collection('adCampaigns').findOne({ submissionId: submission._id });
    if (campaign && new Date(campaign.startDate) <= new Date()) {
      return res.status(400).json({ error: 'Campaign already launched. Use campaign cancellation.' });
    }
    const tx = await db.collection('paymentTransactions').findOne(
      { submissionId: submission._id },
      { sort: { createdAt: -1 } }
    );
    let refundAmountInCents = 0;
    if (submission.paymentMode === 'manual_capture' && submission.paymentIntentId) {
      try {
        await stripeService.releaseAuthorization(submission.paymentIntentId, 'User cancelled before launch');
      } catch (e) {
        console.warn('[prelaunch-cancel] release hold failed, continuing cancel:', e.message);
      }
    } else if (submission.paymentIntentId && tx?.amountInCents > 0) {
      refundAmountInCents = tx.amountInCents;
      try {
        await stripeService.refund(submission.paymentIntentId, 'User cancelled before launch');
      } catch (e) {
        console.warn('[prelaunch-cancel] refund failed, continuing cancel:', e.message);
      }
    }
    const now = new Date();
    await db.collection('adSubmissions').updateOne(
      { _id: submission._id },
      { $set: { status: 'cancelled', cancelledAt: now, updatedAt: now } }
    );
    if (campaign) {
      await db.collection('adCampaigns').updateOne(
        { _id: campaign._id },
        { $set: { status: 'cancelled', cancelledAt: now, updatedAt: now } }
      );
      await db.collection('adTargeting').deleteMany({ campaignId: campaign._id });
    }
    res.json({ message: 'success', data: { cancelled: true, refundAmountInCents } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — permanently remove a draft submission (before payment / before a campaign exists)
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.id) });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });
    if (!advertiser || advertiser.userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (submission.status !== 'draft') {
      return res.status(400).json({
        error: 'Only draft submissions can be deleted. Use “Withdraw submission” on submission status to cancel after you’ve continued past draft.',
      });
    }
    const campaign = await db.collection('adCampaigns').findOne({ submissionId: submission._id });
    if (campaign) {
      return res.status(400).json({ error: 'This submission already has a campaign. Withdraw from submission status instead.' });
    }
    const tx = await db.collection('paymentTransactions').findOne(
      { submissionId: submission._id },
      { sort: { createdAt: -1 } }
    );
    if (tx && tx.status === 'succeeded' && (tx.amountInCents || 0) > 0) {
      return res.status(400).json({ error: 'Payment already completed. Open submission status to manage your order.' });
    }
    if (submission.paymentIntentId) {
      try {
        await stripeService.releaseAuthorization(submission.paymentIntentId, 'Advertiser deleted draft submission');
      } catch (err) {
        console.warn('[delete-submission] Stripe cancel/release:', err.message);
      }
    }
    if (submission.creativeId) {
      await db.collection('adCreatives').deleteOne({ _id: submission.creativeId });
    }
    await db.collection('paymentTransactions').deleteMany({ submissionId: submission._id });
    await db.collection('adSubmissions').deleteOne({ _id: submission._id });
    res.json({ message: 'success', data: { deleted: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — get submission status
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.id) });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    // Verify ownership
    const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });
    if (!advertiser || advertiser.userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ message: 'success', data: submission });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /renew — create a renewal submission from a previous submission
router.post('/renew', async (req, res) => {
  try {
    const db = getDb();
    const { previousSubmissionId } = req.body;

    if (!previousSubmissionId) {
      return res.status(400).json({ error: 'previousSubmissionId is required' });
    }

    if (!ObjectId.isValid(previousSubmissionId)) {
      return res.status(400).json({ error: 'Invalid submission ID' });
    }

    const previousSubmission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(previousSubmissionId) });
    if (!previousSubmission) {
      return res.status(404).json({ error: 'Previous submission not found' });
    }

    const advertiser = await db.collection('advertisers').findOne({ _id: previousSubmission.advertiserId });
    if (!advertiser || advertiser.userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date();
    const previousCampaign = await db.collection('adCampaigns').findOne(
      { submissionId: previousSubmission._id },
      { sort: { createdAt: -1 } },
    );
    const previousPerformance = previousCampaign
      ? await adTrackingService.getCampaignAnalytics(
        previousCampaign._id,
        previousCampaign.startDate,
        previousCampaign.endDate,
      )
      : null;

    // Create new submission starting at step 3 when package context can be reused.
    const newSubmission = {
      advertiserId: advertiser._id,
      status: 'draft',
      currentStep: previousSubmission.package ? 3 : 2,
      package: previousSubmission.package || null,
      targetingRadiusMiles: previousSubmission.targetingRadiusMiles || previousCampaign?.targetingRadiusMiles || 20,
      durationMonths: previousSubmission.durationMonths || previousCampaign?.durationMonths || null,
      totalPriceInCents: previousSubmission.totalPriceInCents || null,
      discountPercent: previousSubmission.discountPercent || 0,
      renewalOfSubmissionId: previousSubmission._id,
      renewalOfCampaignId: previousCampaign?._id || null,
      previousPerformance,
      creativeId: null,
      contractId: null,
      paymentIntentId: null,
      validationResult: null,
      rejectionReason: null,
      submittedAt: null,
      paidAt: null,
      approvedAt: null,
      rejectedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    // Copy creative if previous submission had one
    let copiedCreative = null;
    if (previousSubmission.creativeId) {
      const originalCreative = await db.collection('adCreatives').findOne({ _id: previousSubmission.creativeId });
      if (originalCreative) {
        const creativeCopy = {
          submissionId: null, // will be set after insertion
          advertiserId: advertiser._id,
          headline: originalCreative.headline,
          body: originalCreative.body,
          imageUrl: originalCreative.imageUrl || null,
          ctaText: originalCreative.ctaText,
          ctaUrl: originalCreative.ctaUrl,
          businessName: originalCreative.businessName,
          businessCategory: originalCreative.businessCategory,
          templateType: 'standard',
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        };

        // Insert submission first to get its ID
        const submissionResult = await db.collection('adSubmissions').insertOne(newSubmission);
        const newSubmissionId = submissionResult.insertedId;

        creativeCopy.submissionId = newSubmissionId;
        const creativeResult = await db.collection('adCreatives').insertOne(creativeCopy);

        // Update submission with creativeId
        await db.collection('adSubmissions').updateOne(
          { _id: newSubmissionId },
          { $set: { creativeId: creativeResult.insertedId } }
        );

        copiedCreative = { ...creativeCopy, _id: creativeResult.insertedId };

        return res.status(201).json({
          message: 'success',
          data: {
            submissionId: newSubmissionId,
            creative: copiedCreative,
            renewal: {
              previousSubmissionId: previousSubmission._id,
              previousCampaignId: previousCampaign?._id || null,
              previousPerformance,
              package: newSubmission.package,
              targetingRadiusMiles: newSubmission.targetingRadiusMiles,
              durationMonths: newSubmission.durationMonths,
            },
          },
        });
      }
    }

    // No creative to copy
    const submissionResult = await db.collection('adSubmissions').insertOne(newSubmission);
    res.status(201).json({
      message: 'success',
      data: {
        submissionId: submissionResult.insertedId,
        creative: null,
        renewal: {
          previousSubmissionId: previousSubmission._id,
          previousCampaignId: previousCampaign?._id || null,
          previousPerformance,
          package: newSubmission.package,
          targetingRadiusMiles: newSubmission.targetingRadiusMiles,
          durationMonths: newSubmission.durationMonths,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — create submission (step 1: business info)
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { businessName, category, city, state, contactEmail, websiteUrl, description, businessAddress } = req.body;

    // Validate required fields
    if (!businessName || !category || !city || !state || !contactEmail) {
      return res.status(400).json({ error: 'Missing required fields: businessName, category, city, state, contactEmail' });
    }

    // Validate businessName: 2-100 chars, no HTML
    if (businessName.length < 2 || businessName.length > 100) {
      return res.status(400).json({ error: 'businessName must be 2-100 characters' });
    }
    if (hasHtml(businessName)) {
      return res.status(400).json({ error: 'businessName must not contain HTML' });
    }

    // Validate category
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` });
    }

    // Validate city+state match a seeded region
    const regionKey = `${city.toLowerCase().replace(/\s+/g, '-')}-${state.toLowerCase()}`;
    const region = await db.collection('seeded_regions').findOne({ regionKey });
    if (!region) {
      return res.status(400).json({ error: 'city and state must match a seeded region' });
    }

    // Validate email
    if (!isValidEmail(contactEmail)) {
      return res.status(400).json({ error: 'contactEmail must be a valid email format' });
    }

    // Check city phase — block seeding cities unless this is the first advertiser
    const cityPhase = await cityPhaseService.getCityPhase(regionKey);

    if (cityPhase.phase === 'seeding') {
      // Check if this is the first advertiser for this city
      const existingAdvertiserCount = await db.collection('advertisers').countDocuments({ regionKey });

      if (existingAdvertiserCount === 0) {
        // First advertiser — open city for ads in one write (phase + slots) so step-2 slot checks never see a half-bootstrapped doc.
        const PHASE_SLOT_LIMITS = cityPhaseService.PHASE_SLOT_LIMITS;
        const bootstrapAt = new Date();
        await db.collection('cityAdSettings').updateOne(
          { cityId: regionKey },
          {
            $set: {
              phase: 'growth',
              phaseOverride: true,
              phaseChangedAt: bootstrapAt,
              phasePricing: {
                growth: { featured: 14900, sponsored: 4900, event_7d: 1300, event_14d: 2500 },
                mature: { featured: 19900, sponsored: 5900, event_7d: 1500, event_14d: 3000 },
              },
              slots: {
                featured: {
                  max: PHASE_SLOT_LIMITS.growth.featured,
                  remaining: PHASE_SLOT_LIMITS.growth.featured,
                },
                sponsored: {
                  max: PHASE_SLOT_LIMITS.growth.sponsored,
                  remaining: PHASE_SLOT_LIMITS.growth.sponsored,
                },
              },
              transitionRules: {
                growthToMature: { allSlotsFilled: true, hasWaitlist: false },
              },
              waitlist: [],
              updatedAt: bootstrapAt,
            },
            $setOnInsert: { createdAt: bootstrapAt },
          },
          { upsert: true }
        );
      } else {
        // Not the first advertiser and still seeding — block
        return res.status(400).json({ error: 'Advertising is not yet available in this city.' });
      }
    }

    const now = new Date();

    // Upsert advertiser
    const advertiserDoc = {
      userId: req.user.uid,
      businessName,
      contactEmail,
      category,
      city,
      state,
      regionKey,
      websiteUrl: websiteUrl || null,
      description: description || null,
      businessAddress: businessAddress || null,
      status: 'active',
      updatedAt: now,
    };

    // Geocode business address if provided
    if (businessAddress && businessAddress.trim()) {
      const coords = await geocodeAddress(businessAddress.trim());
      if (coords) {
        advertiserDoc.businessLat = coords.lat;
        advertiserDoc.businessLng = coords.lng;
      }
    }

    const advertiserResult = await db.collection('advertisers').findOneAndUpdate(
      { userId: req.user.uid },
      { $set: advertiserDoc, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'after' }
    );
    const advertiser = advertiserResult.value || advertiserResult;

    // Create submission
    const submission = {
      advertiserId: advertiser._id,
      status: 'draft',
      currentStep: 1,
      package: null,
      creativeId: null,
      contractId: null,
      paymentIntentId: null,
      validationResult: null,
      rejectionReason: null,
      submittedAt: null,
      paidAt: null,
      approvedAt: null,
      rejectedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection('adSubmissions').insertOne(submission);
    res.status(201).json({ message: 'success', data: { submissionId: result.insertedId, ...submission } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — update submission (steps 2-5)
router.put('/:id', async (req, res) => {
  try {
    console.log(`[put-submission] id=${req.params.id} body keys=${Object.keys(req.body || {}).join(',')} step=${req.body?.step}`);
    const db = getDb();
    console.log(`[put-submission] got db`);
    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.id) });
    console.log(`[put-submission] found submission: ${!!submission} currentStep=${submission?.currentStep}`);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    // Verify ownership
    const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });
    console.log(`[put-submission] found advertiser: ${!!advertiser} userId match: ${advertiser?.userId === req.user?.uid}`);
    if (!advertiser || advertiser.userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { step } = req.body;
    const numericStep = typeof step === 'number' ? step : parseInt(step, 10);
    console.log(`[put-submission] step=${step} typeof=${typeof step} numericStep=${numericStep}`);
    if (!numericStep || isNaN(numericStep)) {
      console.log(`[put-submission] REJECTED: step not a number`);
      return res.status(400).json({ error: 'step is required and must be a number' });
    }

    // Allow advancing to next step OR re-submitting current/previous steps (for back-navigation edits)
    // Allow +2 gap to handle race conditions where previous step's write hasn't committed yet
    if (numericStep > submission.currentStep + 2) {
      console.log(`[put-submission] REJECTED: step too far ahead numericStep=${numericStep} currentStep=${submission.currentStep}`);
      return res.status(400).json({ error: `Cannot advance to step ${numericStep}. Current step is ${submission.currentStep}.` });
    }

    const now = new Date();
    // Only advance currentStep forward, never backwards (allows re-editing previous steps)
    const newStep = Math.max(numericStep, submission.currentStep);
    const updateFields = { currentStep: newStep, updatedAt: now };
    console.log(`[put-submission] proceeding with numericStep=${numericStep} newStep=${newStep}`);

    console.log(`[put-submission] step=${step} typeof=${typeof step} numericStep=${numericStep} currentStep=${submission.currentStep} newStep=${newStep}`);

    // Steps 3+ require a persisted package (step 2). Without this, the client could "succeed" on a failed step-2 PUT
    // (empty JSON envelope) and still advance — payment then fails with "package not selected".
    if (numericStep >= 3 && !submission.package) {
      return res.status(400).json({
        error:
          'Package selection must be saved first. Go back to the package step, choose your plan, and tap Continue again.',
      });
    }

    // Step 2: Package selection
    if (numericStep === 2) {
      const packageType = req.body.packageType || req.body.package?.type;
      if (!packageType || !['featured_home', 'inline_listing', 'event_spotlight_7d', 'event_spotlight_14d'].includes(packageType)) {
        console.warn(`[put-submission] step2 reject: bad packageType (${packageType})`);
        return res.status(400).json({ error: 'packageType must be featured_home, inline_listing, event_spotlight_7d, or event_spotlight_14d' });
      }

      const isEventPackage = packageType.startsWith('event_spotlight');

      // Slot counters are informational once a city is open; do not reject package selection when "remaining" is 0.

      // Get phase-aware pricing from pricingService (server-side authoritative)
      const pricing = await pricingService.getPhasePrice(advertiser.regionKey, packageType);

      // Radius targeting
      const validRadii = [20, 30, 40, 50];
      const rawRadius = Number(req.body.targetingRadiusMiles);
      const targetingRadiusMiles = validRadii.includes(rawRadius) ? rawRadius : 20;
      const origin = {
        lat: advertiser.businessLat,
        lng: advertiser.businessLng,
      };
      const baseReach = await radiusTargetingService.resolveRegionKeys(advertiser.regionKey, 20, origin);
      const selectedReach = await radiusTargetingService.resolveRegionKeys(advertiser.regionKey, targetingRadiusMiles, origin);
      const availableRadii = [20];
      for (const miles of [30, 40, 50]) {
        const reach = await radiusTargetingService.resolveRegionKeys(advertiser.regionKey, miles, origin);
        if (reach.regionKeys.length > baseReach.regionKeys.length) {
          availableRadii.push(miles);
        }
      }
      if (targetingRadiusMiles > 20 && selectedReach.regionKeys.length <= baseReach.regionKeys.length) {
        console.warn(`[put-submission] step2 reject: radius ${targetingRadiusMiles} adds no regions`);
        return res.status(400).json({
          error:
            'That reach distance doesn’t include any extra cities beyond 20 miles from your business yet. Choose 20 miles, or pick another radius shown as available on the package screen.',
          code: 'radius_no_extra_reach',
          availableRadii,
        });
      }
      const radiusSurcharge = radiusTargetingService.RADIUS_SURCHARGES[targetingRadiusMiles] || 0;

      if (isEventPackage) {
        // Event packages: fixed duration, no multi-month pricing
        const durationDays = packageType === 'event_spotlight_7d' ? 7 : 14;

        updateFields.package = {
          type: packageType,
          priceInCents: pricing.priceInCents + radiusSurcharge,
          durationDays,
        };
        updateFields.totalPriceInCents = pricing.priceInCents + radiusSurcharge;
      } else {
        // Non-event packages: multi-month duration pricing
        const durationMonths = parseInt(req.body.durationMonths, 10);
        if (![1, 2, 3, 6].includes(durationMonths)) {
          console.warn(`[put-submission] step2 reject: durationMonths=${req.body.durationMonths} parsed=${durationMonths}`);
          return res.status(400).json({ error: 'durationMonths must be 1, 2, 3, or 6' });
        }

        const startDateValidation = pricingService.validateStartDate(req.body.startDate);
        if (!startDateValidation.valid) {
          console.warn(`[put-submission] step2 reject: startDate ${startDateValidation.error}`);
          return res.status(400).json({ error: startDateValidation.error });
        }

        const multiMonth = pricingService.calculateMultiMonthPrice(
          pricing.priceInCents, durationMonths, radiusSurcharge
        );

        updateFields.package = {
          type: packageType,
          priceInCents: pricing.priceInCents, // monthly base rate
          durationDays: durationMonths * 30,  // backward compat
        };
        updateFields.durationMonths = durationMonths;
        updateFields.startDate = startDateValidation.startDate;
        updateFields.startDateCalendar = String(req.body.startDate || '').trim().slice(0, 10);
        updateFields.discountPercent = multiMonth.discountPercent;
        updateFields.totalPriceInCents = multiMonth.totalPriceInCents;
      }

      updateFields.targetingRadiusMiles = targetingRadiusMiles;
    }

    // Step 3: Creative content
    if (numericStep === 3) {
      let { headline, body, ctaText, ctaUrl, imageUrl, additionalImageUrls } = req.body;
      const isEventPackage = submission.package?.type?.startsWith('event_spotlight');
      const eventFields = {};

      if (isEventPackage) {
        const { eventName, eventDate, eventTime, isRecurring, eventLocation } = req.body;

        if (!eventName || eventName.trim().length < 5 || eventName.trim().length > 100) {
          return res.status(400).json({ error: 'eventName must be 5-100 characters for event packages' });
        }
        if (hasHtml(eventName)) return res.status(400).json({ error: 'eventName must not contain HTML' });

        if (!eventDate) {
          return res.status(400).json({ error: 'eventDate is required for event packages' });
        }
        const parsedDate = new Date(eventDate);
        if (isNaN(parsedDate.getTime())) {
          return res.status(400).json({ error: 'eventDate must be a valid date' });
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (parsedDate < today) {
          return res.status(400).json({ error: 'Event date must be today or in the future' });
        }

        if (eventTime && (eventTime.length > 50 || hasHtml(eventTime))) {
          return res.status(400).json({ error: 'eventTime must be at most 50 characters with no HTML' });
        }

        if (eventLocation && (eventLocation.length > 200 || hasHtml(eventLocation))) {
          return res.status(400).json({ error: 'eventLocation must be at most 200 characters with no HTML' });
        }

        eventFields.eventName = eventName.trim();
        eventFields.eventDate = parsedDate;
        eventFields.eventTime = eventTime ? eventTime.trim() : null;
        eventFields.isRecurring = !!isRecurring;
        eventFields.eventLocation = eventLocation ? eventLocation.trim() : null;

        const hn = headline != null ? String(headline).trim() : '';
        headline = (hn.length >= 5 ? hn : eventName.trim()).slice(0, 50);

        const bd = body != null ? String(body).trim() : '';
        if (bd.length >= 10) {
          body = bd.slice(0, 150);
        } else {
          const parts = [`Join us for ${eventName.trim()}.`, `Date: ${String(eventDate).trim()}.`];
          if (eventTime && String(eventTime).trim()) parts.push(String(eventTime).trim());
          if (eventLocation && String(eventLocation).trim()) parts.push(String(eventLocation).trim());
          let auto = parts.join(' ').trim();
          if (auto.length < 10) {
            auto = `${eventName.trim()} — family-friendly event. Tap through for details.`;
          }
          body = auto.slice(0, 150);
        }

        const ct = ctaText != null ? String(ctaText).trim() : '';
        ctaText = ct.length >= 2 ? ct.slice(0, 25) : 'Learn More';
      }

      console.log(`[step3] submissionId=${req.params.id} headline="${headline}" body="${body?.substring(0, 30)}" ctaText="${ctaText}" imageUrl=${imageUrl ? 'present' : 'null'}`);

      if (!headline || headline.length < 5 || headline.length > 50) {
        return res.status(400).json({ error: 'headline must be 5-50 characters' });
      }
      if (hasHtml(headline)) return res.status(400).json({ error: 'headline must not contain HTML' });

      if (!body || body.length < 10 || body.length > 150) {
        return res.status(400).json({ error: 'body must be 10-150 characters' });
      }
      if (hasHtml(body)) return res.status(400).json({ error: 'body must not contain HTML' });

      if (!ctaText || ctaText.length < 2 || ctaText.length > 25) {
        return res.status(400).json({ error: 'ctaText must be 2-25 characters' });
      }
      if (hasHtml(ctaText)) return res.status(400).json({ error: 'ctaText must not contain HTML' });

      if (!ctaUrl || !/^https:\/\/.+/.test(ctaUrl)) {
        return res.status(400).json({ error: 'ctaUrl must be a valid HTTPS URL' });
      }

      let extraUrls = [];
      if (Array.isArray(additionalImageUrls)) {
        extraUrls = additionalImageUrls
          .filter((u) => typeof u === 'string' && /^https:\/\/.+/.test(u.trim()))
          .map((u) => u.trim())
          .slice(0, 12);
      }

      // Brand shown on the ad (can differ from account / billing business name for agencies)
      let creativeBusinessName = advertiser.businessName;
      let creativeBusinessCategory = advertiser.category;
      if (req.body.creativeBusinessName != null && String(req.body.creativeBusinessName).trim() !== '') {
        const bn = String(req.body.creativeBusinessName).trim();
        if (bn.length < 2 || bn.length > 100) {
          return res.status(400).json({ error: 'creativeBusinessName must be 2-100 characters' });
        }
        if (hasHtml(bn)) {
          return res.status(400).json({ error: 'creativeBusinessName must not contain HTML' });
        }
        creativeBusinessName = bn;
      }
      if (req.body.creativeBusinessCategory != null && String(req.body.creativeBusinessCategory).trim() !== '') {
        const cat = String(req.body.creativeBusinessCategory).trim();
        if (!ALLOWED_CATEGORIES.includes(cat)) {
          return res.status(400).json({ error: `creativeBusinessCategory must be one of: ${ALLOWED_CATEGORIES.join(', ')}` });
        }
        creativeBusinessCategory = cat;
      }

      const creativePayload = {
        headline,
        body,
        imageUrl: imageUrl || null,
        additionalImageUrls: extraUrls,
        ctaText,
        ctaUrl,
        businessName: creativeBusinessName,
        businessCategory: creativeBusinessCategory,
        showDistance: !!req.body.showDistance,
        templateType: 'standard',
        status: 'draft',
        ...eventFields,
        updatedAt: now,
      };

      if (submission.creativeId) {
        await db.collection('adCreatives').updateOne(
          { _id: submission.creativeId },
          { $set: creativePayload },
        );
      } else {
        const creative = {
          submissionId: submission._id,
          advertiserId: submission.advertiserId,
          ...creativePayload,
          createdAt: now,
        };
        const creativeResult = await db.collection('adCreatives').insertOne(creative);
        updateFields.creativeId = creativeResult.insertedId;
      }
    }

    // Step 4: Preview (no additional data needed, just advance step)

    // Step 5: Terms acceptance
    if (numericStep === 5) {
      const { termsVersion } = req.body;
      const contract = {
        submissionId: submission._id,
        advertiserId: submission.advertiserId,
        termsVersion: termsVersion || '1.0',
        acceptedAt: now,
        ipAddress: req.ip || req.connection?.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
      };
      const contractResult = await db.collection('contractAgreements').insertOne(contract);
      updateFields.contractId = contractResult.insertedId;
    }

    await db.collection('adSubmissions').updateOne(
      { _id: submission._id },
      { $set: updateFields }
    );

    const updated = await db.collection('adSubmissions').findOne({ _id: submission._id });
    res.json({ message: 'success', data: updated });
  } catch (err) {
    console.error(`[put-submission] ERROR id=${req.params.id} req=${req.id} step=${req.body?.step}:`, err.message, err.stack);
    res.status(500).json({ error: err.message, requestId: req.id });
  }
});

// POST /:id/assets — upload image to GCS ad-assets/ prefix
router.post('/:id/assets', upload.single('image'), async (req, res) => {
  try {
    const db = getDb();
    const submission = await db.collection('adSubmissions').findOne({ _id: new ObjectId(req.params.id) });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    // Verify ownership
    const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });
    if (!advertiser || advertiser.userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Validate MIME type
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: `Invalid image type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}` });
    }

    // Validate file size (multer limits should catch this, but double-check)
    if (req.file.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image must not exceed 2MB' });
    }

    // Upload to GCS with ad-assets/ prefix
    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const filename = `ad-assets/${randomUUID()}.${ext}`;
    const file = bucket.file(filename);
    await file.save(req.file.buffer, {
      metadata: { contentType: req.file.mimetype },
    });
    const imageUrl = `https://storage.googleapis.com/playground_app_bucket/${filename}`;

    res.json({ message: 'success', data: { imageUrl } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
