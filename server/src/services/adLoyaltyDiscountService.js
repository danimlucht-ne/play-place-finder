const crypto = require('crypto');
const { getDb } = require('../database');
const { notifyAdvertiser, resolveAdDisplayName } = require('./advertiserEmailService');

/** Email after campaign ends — only sent if no code exists yet (midpoint may have run first). */
const TEMPLATE_COMPLETED = 'campaign_completed_next_discount';
/** Email when campaign reaches 50% duration — supports booking the next campaign early. */
const TEMPLATE_MIDPOINT = 'campaign_midpoint_next_discount';

function randomCodeSuffix() {
  const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `NEXT20-${hex}`;
}

/**
 * Creates a single-use 20% code for this campaign once (idempotent via loyaltySourceCampaignId)
 * and emails the advertiser. Safe to call from completion and from midpoint cron.
 *
 * @param {import('mongodb').ObjectId} campaignId
 * @param {typeof TEMPLATE_COMPLETED | typeof TEMPLATE_MIDPOINT} emailTemplateKey
 * @param {'midpoint'|'completion'} issuanceKind — stored on discountCodes.createdBy for auditing
 * @returns {Promise<boolean>} true if a new code was inserted (email attempted)
 */
async function issueLoyaltyDiscountForCampaignIfNeeded(campaignId, emailTemplateKey, issuanceKind) {
  const db = getDb();
  if (!campaignId) return false;

  const existing = await db.collection('discountCodes').findOne({
    loyaltySourceCampaignId: campaignId,
  });
  if (existing) return false;

  const campaign = await db.collection('adCampaigns').findOne({ _id: campaignId });
  if (!campaign || !campaign.advertiserId) return false;

  const total = Number(campaign.totalPriceInCents) || 0;
  if (total <= 0) return false;

  const now = new Date();
  const codeValidUntil = new Date(now);
  codeValidUntil.setDate(codeValidUntil.getDate() + 90);

  let code = randomCodeSuffix();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dup = await db.collection('discountCodes').findOne(
      { code: code },
      { collation: { locale: 'en', strength: 2 } },
    );
    if (!dup) break;
    code = randomCodeSuffix();
  }

  const createdBy = issuanceKind === 'midpoint'
    ? 'system_campaign_midpoint'
    : 'system_campaign_completion';

  const doc = {
    code,
    percentOff: 20,
    startDate: now,
    endDate: codeValidUntil,
    maxUses: 1,
    usageCount: 0,
    createdBy,
    active: true,
    advertiserId: campaign.advertiserId,
    loyaltySourceCampaignId: campaignId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.collection('discountCodes').insertOne(doc);
  } catch (err) {
    if (err.code === 11000) return false;
    console.warn('[loyaltyDiscount] insert failed', campaignId.toString(), err.message);
    return false;
  }

  const adDisplayName = await resolveAdDisplayName(db, campaign.creativeId);
  await notifyAdvertiser(campaign.advertiserId, emailTemplateKey, {
    code,
    percentOff: 20,
    endDate: codeValidUntil,
    adDisplayName,
    campaignEndDate: campaign.endDate,
  });
  return true;
}

async function issueLoyaltyDiscountOnCampaignCompletion(campaignId) {
  return issueLoyaltyDiscountForCampaignIfNeeded(campaignId, TEMPLATE_COMPLETED, 'completion');
}

/**
 * For each active paid campaign past the temporal midpoint between startDate and endDate,
 * issues the same loyalty code + email if not already created for that campaign.
 * @returns {Promise<number>} number of new codes issued this run
 */
async function processMidCampaignLoyaltyDiscounts() {
  const db = getDb();
  const nowMs = Date.now();

  const campaigns = await db.collection('adCampaigns').find({
    status: 'active',
    totalPriceInCents: { $gt: 0 },
    startDate: { $exists: true, $ne: null },
    endDate: { $exists: true, $ne: null },
  }).toArray();

  let issued = 0;
  for (const c of campaigns) {
    const start = new Date(c.startDate).getTime();
    const end = new Date(c.endDate).getTime();
    if (!(end > start)) continue;
    const midpoint = start + (end - start) / 2;
    if (nowMs < midpoint) continue;
    const created = await issueLoyaltyDiscountForCampaignIfNeeded(c._id, TEMPLATE_MIDPOINT, 'midpoint');
    if (created) issued += 1;
  }
  return issued;
}

module.exports = {
  issueLoyaltyDiscountForCampaignIfNeeded,
  issueLoyaltyDiscountOnCampaignCompletion,
  processMidCampaignLoyaltyDiscounts,
};
