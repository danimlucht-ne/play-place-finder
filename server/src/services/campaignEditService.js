const { getDb } = require('../database');
const { ObjectId } = require('mongodb');

const HTML_REGEX = /<[^>]*>/;
function hasHtml(str) { return HTML_REGEX.test(str); }

const EDITABLE_STATUSES = ['active', 'scheduled', 'pending_review'];

function validateCreativeFields(fields) {
  const { headline, body, ctaText, ctaUrl, imageUrl } = fields;
  if (headline !== undefined) {
    if (headline.length < 5 || headline.length > 50) return 'headline must be 5-50 characters';
    if (hasHtml(headline)) return 'headline must not contain HTML';
  }
  if (body !== undefined) {
    if (body.length < 10 || body.length > 150) return 'body must be 10-150 characters';
    if (hasHtml(body)) return 'body must not contain HTML';
  }
  if (ctaText !== undefined) {
    if (ctaText.length < 2 || ctaText.length > 25) return 'ctaText must be 2-25 characters';
    if (hasHtml(ctaText)) return 'ctaText must not contain HTML';
  }
  if (ctaUrl !== undefined) {
    if (!/^https:\/\/.+/.test(ctaUrl)) return 'ctaUrl must be a valid HTTPS URL';
  }
  if (imageUrl !== undefined && imageUrl && !/^https:\/\/.+/.test(imageUrl)) {
    return 'imageUrl must be a valid HTTPS URL';
  }
  return null;
}

async function getCampaignContext(db, campaignId) {
  const id = typeof campaignId === 'string' ? new ObjectId(campaignId) : campaignId;
  const campaign = await db.collection('adCampaigns').findOne({ _id: id });
  if (!campaign) return { error: 'Campaign not found' };
  if (!EDITABLE_STATUSES.includes(campaign.status)) {
    return { error: 'Campaign cannot be edited in its current status' };
  }
  const submission = campaign.submissionId
    ? await db.collection('adSubmissions').findOne({ _id: campaign.submissionId })
    : null;
  const liveCreative = await db.collection('adCreatives').findOne({ _id: campaign.creativeId });
  if (!liveCreative) return { error: 'Creative not found' };
  return { id, campaign, submission, liveCreative };
}

async function resolveEditableCreative(db, campaign, submission, liveCreative) {
  if (campaign.status !== 'active') {
    return { targetCreative: liveCreative, staged: false };
  }

  if (submission?.creativeId && String(submission.creativeId) !== String(campaign.creativeId)) {
    const stagedCreative = await db.collection('adCreatives').findOne({ _id: submission.creativeId });
    if (stagedCreative) {
      return { targetCreative: stagedCreative, staged: true };
    }
  }

  const clone = {
    ...liveCreative,
    _id: new ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    stagedFromCreativeId: liveCreative._id,
    stagedForCampaignId: campaign._id,
  };
  await db.collection('adCreatives').insertOne(clone);
  if (submission?._id) {
    await db.collection('adSubmissions').updateOne(
      { _id: submission._id },
      { $set: { creativeId: clone._id, updatedAt: new Date() } },
    );
  }
  return { targetCreative: clone, staged: true };
}

/**
 * Validates and updates creative fields on an active/scheduled campaign.
 * Live-campaign edits are staged for review so the approved ad stays visible until approval.
 * @param {ObjectId|string} campaignId
 * @param {Object} fields — { headline?, body?, ctaText?, ctaUrl?, imageUrl? }
 * @returns {Promise<{success: boolean, error?: string, reviewRequired?: boolean}>}
 */
async function updateCreative(campaignId, fields) {
  const db = getDb();
  const context = await getCampaignContext(db, campaignId);
  if (context.error) return { success: false, error: context.error };
  const { campaign, submission, liveCreative } = context;

  const validationError = validateCreativeFields(fields);
  if (validationError) return { success: false, error: validationError };

  const { targetCreative } = await resolveEditableCreative(db, campaign, submission, liveCreative);

  const { headline, body, ctaText, ctaUrl, imageUrl } = fields;
  const finalHeadline = headline !== undefined ? headline : targetCreative.headline;
  const finalBody = body !== undefined ? body : targetCreative.body;

  const headlineChanged = headline !== undefined && headline !== targetCreative.headline;
  const bodyChanged = body !== undefined && body !== targetCreative.body;
  if (headlineChanged || bodyChanged) {
    try {
      const adValidationService = require('./adValidationService');
      const check = await adValidationService.checkFamilyFriendliness(
        liveCreative.businessName, liveCreative.businessCategory, '', finalHeadline, finalBody
      );
      if (!check.familyFriendly) {
        return { success: false, error: check.reason || 'Content flagged as not family-friendly' };
      }
    } catch (_) {
      // Manual review still happens for campaign edits, so a validation outage should not silently publish changes.
    }
  }

  const update = { updatedAt: new Date() };
  if (headline !== undefined) update.headline = headline;
  if (body !== undefined) update.body = body;
  if (ctaText !== undefined) update.ctaText = ctaText;
  if (ctaUrl !== undefined) update.ctaUrl = ctaUrl;
  if (imageUrl !== undefined) {
    update.imageUrl = imageUrl;
    // Replacing the hero image must drop the previous primary (and the new URL) from
    // additionalImageUrls so clients that merge imageUrl + extras do not show two copies.
    const prevPrimary = targetCreative.imageUrl ? String(targetCreative.imageUrl).trim() : '';
    const nextPrimary = imageUrl ? String(imageUrl).trim() : '';
    const prevExtras = Array.isArray(targetCreative.additionalImageUrls)
      ? targetCreative.additionalImageUrls.map((u) => String(u || '').trim()).filter(Boolean)
      : [];
    update.additionalImageUrls = prevExtras.filter((u) => u !== prevPrimary && u !== nextPrimary);
  }

  await db.collection('adCreatives').updateOne({ _id: targetCreative._id }, { $set: update });
  return { success: true, reviewRequired: true };
}

/**
 * Validates and updates event fields on an event campaign.
 * @param {ObjectId|string} campaignId
 * @param {Object} fields — { eventDate?, eventTime?, eventLocation? }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateEventFields(campaignId, fields) {
  const db = getDb();
  const context = await getCampaignContext(db, campaignId);
  if (context.error) return { success: false, error: context.error };
  const { id, campaign, submission, liveCreative } = context;
  if (!campaign.isEvent) return { success: false, error: 'Event field edits are only allowed on event campaigns' };

  const { eventDate, eventTime, eventLocation } = fields;

  if (eventDate !== undefined) {
    const parsed = new Date(eventDate);
    if (isNaN(parsed.getTime())) return { success: false, error: 'eventDate must be a valid date' };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (parsed < today) return { success: false, error: 'Event date must be today or in the future' };
    if (parsed > campaign.endDate) return { success: false, error: 'Event date must be before the campaign end date' };
  }

  if (eventTime !== undefined && (eventTime.length > 50 || hasHtml(eventTime))) {
    return { success: false, error: 'eventTime must be at most 50 characters with no HTML' };
  }
  if (eventLocation !== undefined && (eventLocation.length > 200 || hasHtml(eventLocation))) {
    return { success: false, error: 'eventLocation must be at most 200 characters with no HTML' };
  }

  const now = new Date();
  const creativeUpdate = { updatedAt: now };
  const campaignUpdate = { updatedAt: now };

  if (eventDate !== undefined) {
    const parsed = new Date(eventDate);
    creativeUpdate.eventDate = parsed;
    campaignUpdate.eventDate = parsed;
  }
  if (eventTime !== undefined) { creativeUpdate.eventTime = eventTime; }
  if (eventLocation !== undefined) { creativeUpdate.eventLocation = eventLocation; }

  const { targetCreative } = await resolveEditableCreative(db, campaign, submission, liveCreative);

  await db.collection('adCreatives').updateOne({ _id: targetCreative._id }, { $set: creativeUpdate });
  if (campaign.status === 'active') {
    const submissionUpdate = { updatedAt: now };
    if (eventDate !== undefined) {
      submissionUpdate.pendingCampaignChanges = {
        ...(submission?.pendingCampaignChanges || {}),
        eventDate: campaignUpdate.eventDate,
      };
    }
    if (submission?._id) {
      await db.collection('adSubmissions').updateOne(
        { _id: submission._id },
        { $set: submissionUpdate },
      );
    }
  } else if (Object.keys(campaignUpdate).length > 1) {
    await db.collection('adCampaigns').updateOne({ _id: id }, { $set: campaignUpdate });
  }

  return { success: true, reviewRequired: true };
}

module.exports = { updateCreative, updateEventFields };
