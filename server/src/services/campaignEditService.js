const { getDb } = require('../database');
const { ObjectId } = require('mongodb');

const HTML_REGEX = /<[^>]*>/;
function hasHtml(str) { return HTML_REGEX.test(str); }

const EDITABLE_STATUSES = ['active', 'scheduled', 'pending_review'];

/**
 * Validates and updates creative fields on an active/scheduled campaign.
 * Re-runs Gemini family-friendliness check on updated content.
 * @param {ObjectId|string} campaignId
 * @param {Object} fields — { headline?, body?, ctaText?, ctaUrl?, imageUrl? }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateCreative(campaignId, fields) {
  const db = getDb();
  const id = typeof campaignId === 'string' ? new ObjectId(campaignId) : campaignId;
  const campaign = await db.collection('adCampaigns').findOne({ _id: id });
  if (!campaign) return { success: false, error: 'Campaign not found' };
  if (!EDITABLE_STATUSES.includes(campaign.status)) {
    return { success: false, error: 'Campaign cannot be edited in its current status' };
  }

  const { headline, body, ctaText, ctaUrl, imageUrl } = fields;
  // Validate fields that are provided
  if (headline !== undefined) {
    if (headline.length < 5 || headline.length > 50) return { success: false, error: 'headline must be 5-50 characters' };
    if (hasHtml(headline)) return { success: false, error: 'headline must not contain HTML' };
  }
  if (body !== undefined) {
    if (body.length < 10 || body.length > 150) return { success: false, error: 'body must be 10-150 characters' };
    if (hasHtml(body)) return { success: false, error: 'body must not contain HTML' };
  }
  if (ctaText !== undefined) {
    if (ctaText.length < 2 || ctaText.length > 25) return { success: false, error: 'ctaText must be 2-25 characters' };
    if (hasHtml(ctaText)) return { success: false, error: 'ctaText must not contain HTML' };
  }
  if (ctaUrl !== undefined) {
    if (!/^https:\/\/.+/.test(ctaUrl)) return { success: false, error: 'ctaUrl must be a valid HTTPS URL' };
  }

  // Get current creative for Gemini check
  const creative = await db.collection('adCreatives').findOne({ _id: campaign.creativeId });
  if (!creative) return { success: false, error: 'Creative not found' };

  const finalHeadline = headline !== undefined ? headline : creative.headline;
  const finalBody = body !== undefined ? body : creative.body;

  const headlineChanged = headline !== undefined && headline !== creative.headline;
  const bodyChanged = body !== undefined && body !== creative.body;
  if (headlineChanged || bodyChanged) {
    try {
      const adValidationService = require('./adValidationService');
      const check = await adValidationService.checkFamilyFriendliness(
        creative.businessName, creative.businessCategory, '', finalHeadline, finalBody
      );
      if (!check.familyFriendly) {
        return { success: false, error: check.reason || 'Content flagged as not family-friendly' };
      }
    } catch (_) { /* If AI unavailable, allow the edit */ }
  }

  // Build update
  const update = { updatedAt: new Date() };
  if (headline !== undefined) update.headline = headline;
  if (body !== undefined) update.body = body;
  if (ctaText !== undefined) update.ctaText = ctaText;
  if (ctaUrl !== undefined) update.ctaUrl = ctaUrl;
  if (imageUrl !== undefined) update.imageUrl = imageUrl;

  await db.collection('adCreatives').updateOne({ _id: campaign.creativeId }, { $set: update });
  return { success: true };
}

/**
 * Validates and updates event fields on an event campaign.
 * @param {ObjectId|string} campaignId
 * @param {Object} fields — { eventDate?, eventTime?, eventLocation? }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateEventFields(campaignId, fields) {
  const db = getDb();
  const id = typeof campaignId === 'string' ? new ObjectId(campaignId) : campaignId;
  const campaign = await db.collection('adCampaigns').findOne({ _id: id });
  if (!campaign) return { success: false, error: 'Campaign not found' };
  if (!campaign.isEvent) return { success: false, error: 'Event field edits are only allowed on event campaigns' };
  if (!EDITABLE_STATUSES.includes(campaign.status)) {
    return { success: false, error: 'Campaign cannot be edited in its current status' };
  }

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

  await db.collection('adCreatives').updateOne({ _id: campaign.creativeId }, { $set: creativeUpdate });
  if (Object.keys(campaignUpdate).length > 1) {
    await db.collection('adCampaigns').updateOne({ _id: id }, { $set: campaignUpdate });
  }

  return { success: true };
}

module.exports = { updateCreative, updateEventFields };
