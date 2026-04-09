const { getDb } = require('../database');
const vision = require('@google-cloud/vision');
const axios = require('axios');

let ai;
try {
  const { GoogleGenAI } = require('@google/genai');
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} catch (_) {
  ai = null;
}

const visionClient = new vision.ImageAnnotatorClient(
  process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? { keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS }
    : {}
);

// --- Constants ---

const PROHIBITED_CATEGORIES = ['alcohol', 'tobacco', 'gambling', 'adult', 'firearms', 'cannabis'];

const DISPOSABLE_EMAIL_DOMAINS = ['tempmail.com', 'throwaway.email', 'guerrillamail.com'];

const SUSPICIOUS_KEYWORDS = ['free money', 'guaranteed', 'miracle', 'act now'];

/** Skip Gemini when the public business name clearly indicates conventional healthcare. */
function isLikelyBenignHealthcare(businessName) {
  const n = String(businessName || '');
  return /\b(physical therapy|physiotherapy|physio|physiatrist|pediatric|paediatric|chiropract|chiro\b|dental|dentist|orthodont|vision|optomet|optical|family medicine|primary care|urgent care|walk-?in clinic|medical clinic|rehab|rehabilitation|occupational therapy|speech therapy|therapy clinic|sports medicine|orthopedic|orthopaedic|massage therapy|licensed massage)\b/i.test(
    n,
  );
}

const FLAG_DESCRIPTIONS = {
  prohibited_category: 'Business category is prohibited (alcohol, tobacco, gambling, adult, firearms, cannabis)',
  unsafe_image: 'Image flagged by SafeSearch for adult or violent content',
  fraud_disposable_email: 'Advertiser is using a disposable email domain',
  suspicious_content: 'Text content contains suspicious marketing keywords',
  not_family_friendly: 'Gemini flagged business as potentially not family-friendly',
  no_online_presence: 'Button link (URL) is unreachable or invalid',
  premium_placement: 'Submission requests premium Featured Home placement — requires manual review',
  duplicate_business: 'A business with the same name already exists in this city',
  validation_service_error: 'Automated validation service was unavailable — manual review required',
};

const FLAG_SEVERITY = {
  prohibited_category: 'high',
  unsafe_image: 'high',
  fraud_disposable_email: 'high',
  suspicious_content: 'medium',
  not_family_friendly: 'high',
  no_online_presence: 'medium',
  premium_placement: 'low',
  duplicate_business: 'medium',
  validation_service_error: 'medium',
};

// --- Helpers ---

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Gemini Family-Friendliness Check ---

/**
 * Uses Gemini AI to evaluate whether a business is appropriate for a kids/family app.
 * Fails open — if AI is unavailable or errors, assumes family-friendly.
 * @param {string} businessName
 * @param {string} category
 * @param {string} description
 * @param {string} headline
 * @param {string} body
 * @returns {Promise<{familyFriendly: boolean, reason?: string}>}
 */
async function checkFamilyFriendliness(businessName, category, description, headline, body) {
  if (!ai) {
    return { familyFriendly: true };
  }

  if (isLikelyBenignHealthcare(businessName)) {
    return { familyFriendly: true, reason: 'Conventional healthcare/services — no LLM review' };
  }

  try {
    const { logGeminiCall } = require('./geminiCostLogger');
    const model = process.env.GEMINI_MODEL_TEXT || process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash';
    const prompt = `You are a content reviewer for a kids and family playground finder app. Evaluate whether the following business advertisement is appropriate for a family-friendly audience (children and parents).

Business Name: ${businessName || 'N/A'}
Category: ${category || 'N/A'}
Description: ${description || 'N/A'}
Ad Headline: ${headline || 'N/A'}
Ad Body: ${body || 'N/A'}

Respond ONLY with valid JSON in this exact format:
{ "familyFriendly": true/false, "reason": "brief explanation" }

Rules:
- Set familyFriendly to TRUE for licensed, conventional healthcare and family services: physical therapy, occupational therapy, speech therapy, chiropractic, dental, pediatrics, family medicine, urgent care, vision care, orthopedics, sports medicine, licensed massage therapy, tutoring, music lessons for children, etc. Words like "touch" or "therapy" in a clear medical or therapeutic business name are NOT adult content.
- Set familyFriendly to TRUE for ordinary retail, dining, entertainment, and kids' activities that are not adult-oriented.
- Set familyFriendly to FALSE only for clear red flags: adult entertainment, sexual services, escort or sensual massage, substance abuse lounges, weapons, gambling (except benign family bingo), hate content, illegal services, or marketing clearly aimed at adults only in an inappropriate way.`;

    const { retryWithBackoff } = require('./retryWithBackoff');
    const t0 = Date.now();
    const response = await retryWithBackoff(
      () => ai.models.generateContent({ model, contents: prompt }),
      { maxRetries: 2, baseDelayMs: 2000, label: 'gemini-family-check' }
    );

    const text = response.text.trim();
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    logGeminiCall({
      callSite: 'adValidation.family',
      model,
      multimodal: false,
      ms: Date.now() - t0,
    });

    return {
      familyFriendly: parsed.familyFriendly === true,
      reason: parsed.reason || undefined,
    };
  } catch (err) {
    console.error('Gemini family-friendliness check failed, defaulting to family-friendly:', err.message);
    return { familyFriendly: true };
  }
}

// --- Validation Functions ---

/**
 * Checks a single creative image for prohibited content via Google Cloud Vision SafeSearch.
 * @param {string} imageUrl
 * @returns {Promise<{safe: boolean, flags: string[]}>}
 */
async function validateImage(imageUrl) {
  try {
    const [result] = await visionClient.safeSearchDetection(imageUrl);
    const safe = result.safeSearchAnnotation;
    if (!safe) {
      return { safe: true, flags: [] };
    }
    const riskyLevels = ['LIKELY', 'VERY_LIKELY'];
    const flags = [];
    if (riskyLevels.includes(safe.adult)) flags.push('unsafe_image');
    if (riskyLevels.includes(safe.violence)) flags.push('unsafe_image');
    if (riskyLevels.includes(safe.racy)) flags.push('unsafe_image');
    // Deduplicate
    const uniqueFlags = [...new Set(flags)];
    return { safe: uniqueFlags.length === 0, flags: uniqueFlags };
  } catch (err) {
    console.error('Image validation service error:', err.message);
    return { safe: false, flags: ['validation_service_error'] };
  }
}

/**
 * Validates that a URL is reachable.
 * @param {string} url
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function validateUrl(url) {
  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('URL check timed out')), ms));
  try {
    const response = await Promise.race([
      axios.head(url, { timeout: 5000, maxRedirects: 5 }),
      timeout(6000),
    ]);
    return { valid: response.status >= 200 && response.status < 400 };
  } catch (err) {
    try {
      const response = await Promise.race([
        axios.get(url, { timeout: 5000, maxRedirects: 5 }),
        timeout(6000),
      ]);
      return { valid: response.status >= 200 && response.status < 400 };
    } catch (getErr) {
      return { valid: false, reason: getErr.message };
    }
  }
}

/**
 * Runs the full validation pipeline on a paid submission.
 * @param {string} submissionId — ObjectId of the adSubmission
 * @returns {Promise<{decision: 'auto_approve'|'manual_review'|'auto_reject', flags: string[]}>}
 */
async function runValidation(submissionId) {
  const db = getDb();
  const submission = await db.collection('adSubmissions').findOne({ _id: submissionId });
  if (!submission) {
    throw new Error('Submission not found');
  }
  if (submission.validationResult?.checkedAt) {
    return {
      decision: submission.validationResult.decision || 'unknown',
      flags: submission.validationResult.flags || [],
      skipped: true,
    };
  }

  const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });
  const creative = await db.collection('adCreatives').findOne({ _id: submission.creativeId });
  if (!creative) {
    return finalizeValidation(submissionId, 'manual_review', ['validation_service_error']);
  }

  const flags = [];

  // --- Auto-reject checks (highest priority) ---

  // Prohibited business category
  if (PROHIBITED_CATEGORIES.includes(advertiser.category)) {
    return finalizeValidation(submissionId, 'auto_reject', ['prohibited_category']);
  }

  // Image safety via SafeSearch
  try {
    const imageSafety = await validateImage(creative.imageUrl);
    if (!imageSafety.safe) {
      // validation_service_error should go to manual review, not auto-reject
      if (imageSafety.flags.includes('validation_service_error')) {
        flags.push('validation_service_error');
      } else {
        return finalizeValidation(submissionId, 'auto_reject', imageSafety.flags);
      }
    }
  } catch (err) {
    flags.push('validation_service_error');
  }

  // Disposable email domain
  const emailDomain = advertiser.contactEmail.split('@')[1];
  if (DISPOSABLE_EMAIL_DOMAINS.includes(emailDomain)) {
    return finalizeValidation(submissionId, 'auto_reject', ['fraud_disposable_email']);
  }

  // --- Manual review checks ---

  // Suspicious keywords in text content
  const allText = `${creative.headline} ${creative.body} ${advertiser.description || ''}`.toLowerCase();
  for (const keyword of SUSPICIOUS_KEYWORDS) {
    if (allText.includes(keyword)) {
      flags.push('suspicious_content');
      break;
    }
  }

  // Gemini family-friendliness review (use creative brand fields — may differ from account business name)
  const displayBusinessName = (creative.businessName && String(creative.businessName).trim())
    || advertiser.businessName;
  const displayCategory = (creative.businessCategory && String(creative.businessCategory).trim())
    || advertiser.category;
  try {
    const ffCheck = await checkFamilyFriendliness(
      displayBusinessName, displayCategory,
      advertiser.description, creative.headline, creative.body
    );
    if (!ffCheck.familyFriendly) {
      flags.push('not_family_friendly');
    }
  } catch (_) {}

  // CTA URL reachability
  if (creative.ctaUrl) {
    try {
      const urlCheck = await validateUrl(creative.ctaUrl);
      if (!urlCheck.valid) {
        flags.push('no_online_presence');
      }
    } catch (err) {
      flags.push('validation_service_error');
    }
  }

  // Prime home row + event packages that include the home hero (see campaign lifecycle) get manual review
  if (submission.package) {
    const t = submission.package.type;
    if (t === 'featured_home' || t === 'event_spotlight_7d_home' || t === 'event_spotlight_14d_home') {
      flags.push('premium_placement');
    }
  }

  // Duplicate business name in same city (compare the brand on the ad, not only the account name)
  const duplicate = await db.collection('advertisers').findOne({
    _id: { $ne: advertiser._id },
    businessName: { $regex: new RegExp(`^${escapeRegex(displayBusinessName)}$`, 'i') },
    regionKey: advertiser.regionKey,
  });
  if (duplicate) {
    flags.push('duplicate_business');
  }

  // --- Decision ---
  const uniqueFlags = [...new Set(flags)];
  if (uniqueFlags.length > 0) {
    return finalizeValidation(submissionId, 'manual_review', uniqueFlags);
  }

  return finalizeValidation(submissionId, 'auto_approve', []);
}

/**
 * Finalizes validation by updating the submission, inserting flags, and triggering side effects.
 * @param {string} submissionId
 * @param {'auto_approve'|'manual_review'|'auto_reject'} decision
 * @param {string[]} flags
 * @returns {Promise<{decision: string, flags: string[]}>}
 */
async function finalizeValidation(submissionId, decision, flags) {
  const uniqueFlags = [...new Set(flags || [])];
  const db = getDb();
  const campaignLifecycleService = require('./campaignLifecycleService');
  const stripeService = require('./stripeService');
  const submission = await db.collection('adSubmissions').findOne({ _id: submissionId });
  const paidTx = await db.collection('paymentTransactions').findOne({
    submissionId,
    status: 'succeeded',
  });
  const isCapturedPaid = !!paidTx;

  const statusMap = {
    auto_approve: 'approved',
    manual_review: 'manual_review',
    auto_reject: 'rejected',
  };

  const stepFloor = Math.max(Number(submission?.currentStep) || 1, 6);

  const update = {
    status: statusMap[decision],
    validationResult: { decision, flags: uniqueFlags, checkedAt: new Date() },
    currentStep: stepFloor,
    updatedAt: new Date(),
  };

  /** After manual auth + auto-approve, capture immediately so the submission shows paid and My Campaigns gets a row (otherwise we waited until startDate in cron). */
  let activateAfterUpdate = isCapturedPaid;

  if (decision === 'auto_approve') {
    update.approvedAt = new Date();
    if (isCapturedPaid) {
      // status stays approved
    } else if (submission?.paymentMode === 'manual_capture' && submission?.paymentIntentId) {
      try {
        await stripeService.captureOrChargeSubmission(submission);
        await db.collection('paymentTransactions').updateOne(
          { submissionId, stripePaymentIntentId: submission.paymentIntentId },
          { $set: { status: 'succeeded', updatedAt: new Date() } }
        );
        update.status = 'approved';
        update.paidAt = new Date();
        update.paymentStatus = 'captured';
        activateAfterUpdate = true;
      } catch (e) {
        console.error('[finalizeValidation] immediate capture failed:', e.message);
        update.status = 'approved_pending_charge';
      }
    } else {
      update.status = 'approved_pending_charge';
    }
  }
  if (decision === 'auto_reject') update.rejectedAt = new Date();

  await db.collection('adSubmissions').updateOne(
    { _id: submissionId },
    { $set: update }
  );

  // Insert review flags for manual review
  if (decision === 'manual_review') {
    const flagDocs = uniqueFlags.map(f => ({
      submissionId,
      flagType: f,
      description: FLAG_DESCRIPTIONS[f] || f,
      severity: FLAG_SEVERITY[f] || 'medium',
      autoGenerated: true,
      resolvedAt: null,
      createdAt: new Date(),
    }));
    if (flagDocs.length > 0) {
      await db.collection('reviewFlags').insertMany(flagDocs);
    }
  }

  // Auto-approve → activate campaign (paid capture, free tx, or just captured above)
  if (decision === 'auto_approve' && activateAfterUpdate) {
    await campaignLifecycleService.activateCampaign(submissionId);
  }

  // Auto-reject → refund payment
  if (decision === 'auto_reject') {
    if (submission?.paymentMode === 'manual_capture' && submission.paymentIntentId) {
      await stripeService.releaseAuthorization(submission.paymentIntentId, 'Submission rejected: ' + uniqueFlags.join(', '));
    } else if (submission?.paymentIntentId) {
      await stripeService.refund(submission.paymentIntentId, 'Submission rejected: ' + uniqueFlags.join(', '));
    }
  }

  if (decision !== 'auto_reject') {
    const { notifyPaymentCapturedIfNeeded } = require('./adCampaignEmailTriggers');
    await notifyPaymentCapturedIfNeeded(submissionId);
  }

  return { decision, flags: uniqueFlags };
}

module.exports = {
  runValidation,
  validateImage,
  validateUrl,
  checkFamilyFriendliness,
  finalizeValidation,
  isLikelyBenignHealthcare,
  PROHIBITED_CATEGORIES,
  DISPOSABLE_EMAIL_DOMAINS,
  SUSPICIOUS_KEYWORDS,
  FLAG_DESCRIPTIONS,
  FLAG_SEVERITY,
};
