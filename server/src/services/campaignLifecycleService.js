const { getDb } = require('../database');
const { canonicalRegionKeyForAds } = require('../utils/regionKeyForAds');
const { ObjectId } = require('mongodb');
const cityPhaseService = require('./cityPhaseService');
const radiusTargetingService = require('./radiusTargetingService');
const stripeService = require('./stripeService');
const { notifyAdvertiser, resolveAdDisplayName } = require('./advertiserEmailService');
const {
  notifyPaymentCapturedIfNeeded,
  notifyCampaignLifecycleAfterActivation,
  notifyCampaignNowLiveIfNeeded,
} = require('./adCampaignEmailTriggers');
const {
  issueLoyaltyDiscountOnCampaignCompletion,
  processMidCampaignLoyaltyDiscounts,
} = require('./adLoyaltyDiscountService');
const { addCalendarMonthsYmd, calendarYmdFromValue } = require('./adCampaignDisplayHelpers');

/**
 * Activates a campaign after a submission is approved.
 * Creates adCampaign and adTargeting records.
 * @param {ObjectId|string} submissionId
 * @returns {Promise<{campaignId: ObjectId}>}
 */
async function activateCampaign(submissionId) {
  const db = getDb();
  const existingCampaign = await db.collection('adCampaigns').findOne({ submissionId });
  if (existingCampaign) {
    if (existingCampaign.status === 'pending_review') {
      const now = new Date();
      const startDay = new Date(existingCampaign.startDate || now);
      startDay.setHours(0, 0, 0, 0);
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const nextStatus = startDay > today ? 'scheduled' : 'active';
      await db.collection('adCampaigns').updateOne(
        { _id: existingCampaign._id },
        { $set: { status: nextStatus, updatedAt: now } }
      );
    }
    // Repair missing targeting (e.g. partial writes or legacy data) so serving can find the campaign.
    const targetingCount = await db.collection('adTargeting').countDocuments({ campaignId: existingCampaign._id });
    if (targetingCount === 0) {
      const keys = existingCampaign.targetedRegionKeys?.length
        ? existingCampaign.targetedRegionKeys
        : [existingCampaign.cityId].filter(Boolean);
      const pl = existingCampaign.placement || 'inline_listing';
      const isEv = !!existingCampaign.isEvent;
      const pls = isEv && pl === 'featured_home'
        ? ['featured_home', 'inline_listing']
        : [pl];
      const now = new Date();
      for (const rk of keys) {
        for (const placement of pls) {
          await db.collection('adTargeting').insertOne({
            campaignId: existingCampaign._id,
            cityId: canonicalRegionKeyForAds(rk),
            placement,
            priority: 1,
            createdAt: now,
          });
        }
      }
      if (keys.length > 0) {
        console.warn('[campaignLifecycle] Repaired missing adTargeting for campaign', String(existingCampaign._id));
      }
    }
    await notifyCampaignLifecycleAfterActivation(submissionId);
    return { campaignId: existingCampaign._id };
  }
  const submission = await db.collection('adSubmissions').findOne({ _id: submissionId });
  const advertiser = await db.collection('advertisers').findOne({ _id: submission.advertiserId });

  const now = new Date();

  // Use submission's startDate if available, otherwise default to now
  const startDate = submission.startDate ? new Date(submission.startDate) : now;

  let endDate;
  if (submission.durationMonths && submission.startDate) {
    // New path: compute endDate by adding durationMonths calendar months to startDate
    endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + submission.durationMonths);
  } else {
    // Legacy fallback: use durationDays from the package
    const durationDays = submission.package?.durationDays || 30;
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays);
  }

  // If startDate is in the future, schedule instead of activate
  const startDay = new Date(startDate);
  startDay.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const status = startDay > today ? 'scheduled' : 'active';

  // Determine if this is an event campaign
  const isEventPackage = (submission.package?.type || '').startsWith('event_spotlight');
  /** Event + `*_home` package: prime-style reach (featured row) and list/calendar (dual adTargeting). */
  const isEventPrimePackage = isEventPackage && (submission.package?.type || '').endsWith('_home');

  const cityPhaseInfo = await cityPhaseService.getCityPhase(advertiser.regionKey);
  const cityPhaseForCampaign = !cityPhaseInfo.advertisingOpen
    ? 'seeding'
    : (cityPhaseInfo.phase === 'mature' ? 'mature' : 'growing');

  // For event campaigns, read event fields from creative
  let eventFields = {};
  if (isEventPackage && submission.creativeId) {
    const creative = await db.collection('adCreatives').findOne({ _id: submission.creativeId });
    if (creative) {
      eventFields = {
        isEvent: true,
        eventDate: creative.eventDate || null,
        isRecurring: creative.isRecurring || false,
      };
    }
  }

  // Resolve multi-region targeting
  const targetingRadius = submission.targetingRadiusMiles || 20;
  let targetedRegionKeys = [advertiser.regionKey];
  try {
    const resolved = await radiusTargetingService.resolveRegionKeys(
      advertiser.regionKey,
      targetingRadius,
      {
        lat: advertiser.businessLat,
        lng: advertiser.businessLng,
      }
    );
    targetedRegionKeys = resolved.regionKeys;
  } catch (err) {
    console.warn('[campaignLifecycle] Radius resolution failed, using home region only:', err.message);
  }

  const startDateCalendar = submission.startDateCalendar || calendarYmdFromValue(submission.startDate);
  let endDateCalendar = '';
  if (submission.durationMonths && startDateCalendar) {
    endDateCalendar = addCalendarMonthsYmd(startDateCalendar, submission.durationMonths);
  }
  if (!endDateCalendar) {
    endDateCalendar = calendarYmdFromValue(endDate);
  }

  const campaign = {
    submissionId,
    advertiserId: submission.advertiserId,
    creativeId: submission.creativeId,
    status,
    // Event list: inline_listing. Event prime (*_home): primary slot is featured_home; we also target
    // inline_listing so the same event appears in list + calendar surfaces.
    placement: isEventPackage
      ? (isEventPrimePackage ? 'featured_home' : 'inline_listing')
      : submission.package.type,
    startDate,
    endDate,
    startDateCalendar,
    endDateCalendar,
    durationMonths: submission.durationMonths || null,
    totalPriceInCents: submission.totalPriceInCents || null,
    discountPercent: submission.discountPercent || 0,
    impressions: 0,
    clicks: 0,
    cityId: advertiser.regionKey,
    targetedRegionKeys,
    targetingRadiusMiles: targetingRadius,
    cityPhaseAtPurchase: cityPhaseForCampaign,
    pricingLock: null,
    ...eventFields,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection('adCampaigns').insertOne(campaign);
  const campaignId = result.insertedId;

  const targetingPlacements = isEventPackage && isEventPrimePackage
    ? ['featured_home', 'inline_listing']
    : [campaign.placement];

  // Create adTargeting records for all targeted regions
  for (const rk of targetedRegionKeys) {
    for (const pl of targetingPlacements) {
      await db.collection('adTargeting').insertOne({
        campaignId,
        cityId: canonicalRegionKeyForAds(rk),
        placement: pl,
        priority: 1,
        createdAt: now,
      });
    }
  }

  await notifyCampaignLifecycleAfterActivation(submissionId);

  return { campaignId };
}

/**
 * Checks and transitions campaigns based on date.
 * scheduled → active (when startDate reached)
 * active → completed (when endDate passed)
 * @returns {Promise<{activated: number, completed: number, eventExpired: number}>}
 */
async function processLifecycleTransitions() {
  const db = getDb();
  const now = new Date();

  // Approved-but-not-charged submissions go live only after payment capture/charge at startDate.
  const dueSubmissions = await db.collection('adSubmissions').find({
    status: 'approved_pending_charge',
    startDate: { $lte: now },
  }).toArray();
  for (const sub of dueSubmissions) {
    try {
      await stripeService.captureOrChargeSubmission(sub);
      const freshSub = await db.collection('adSubmissions').findOne({ _id: sub._id });
      if (freshSub?.paymentMode === 'manual_capture' && freshSub.paymentIntentId) {
        await db.collection('paymentTransactions').updateOne(
          { submissionId: sub._id, stripePaymentIntentId: freshSub.paymentIntentId },
          { $set: { status: 'succeeded', updatedAt: new Date() } }
        );
      }
      await db.collection('adSubmissions').updateOne(
        { _id: sub._id },
        { $set: { status: 'approved', paidAt: new Date(), paymentStatus: 'captured', updatedAt: new Date() } }
      );
      await notifyPaymentCapturedIfNeeded(sub._id);
      await activateCampaign(sub._id);
    } catch (err) {
      console.warn('[campaignLifecycle] charge/capture failed for submission', sub._id?.toString?.(), err.message);
    }
  }

  // Scheduled → Active (per campaign so we can send "now live" once)
  const dueScheduled = await db.collection('adCampaigns').find({
    status: 'scheduled',
    startDate: { $lte: now },
  }).toArray();
  let activatedCount = 0;
  for (const c of dueScheduled) {
    const r = await db.collection('adCampaigns').updateOne(
      { _id: c._id, status: 'scheduled' },
      { $set: { status: 'active', updatedAt: now } }
    );
    if (r.modifiedCount === 0) continue;
    activatedCount += 1;
    await notifyCampaignNowLiveIfNeeded(c._id);
  }

  // Active → Completed — collect IDs first to avoid fragile updatedAt matching
  const toComplete = await db.collection('adCampaigns')
    .find({ status: 'active', endDate: { $lt: now } })
    .toArray();
  const toCompleteIds = toComplete.map(c => c._id);

  let completedCount = 0;
  if (toCompleteIds.length > 0) {
    const completed = await db.collection('adCampaigns').updateMany(
      { _id: { $in: toCompleteIds } },
      { $set: { status: 'completed', updatedAt: now } }
    );
    completedCount = completed.modifiedCount;
  }

  const completedCampaigns = toComplete;

  for (const campaign of completedCampaigns) {
    await db.collection('adSubmissions').updateOne(
      { _id: campaign.submissionId },
      { $set: { status: 'completed', updatedAt: now } }
    );

    await db.collection('adTargeting').deleteMany({ campaignId: campaign._id });

    try {
      await issueLoyaltyDiscountOnCampaignCompletion(campaign._id);
    } catch (err) {
      console.warn('[campaignLifecycle] loyalty discount issue failed', campaign._id?.toString?.(), err.message);
    }
  }

  // Auto-expire non-recurring event campaigns past their event date
  const eventExpired = await processEventExpirations(db, now);

  return { activated: activatedCount, completed: completedCount, eventExpired };
}

/**
 * Processes expired intro pricing locks.
 * Campaigns past priceLockedUntil get their lock cleared.
 * @returns {Promise<{expired: number}>}
 */
async function processIntroExpirations() {
  const db = getDb();
  const now = new Date();

  const expiredCampaigns = await db.collection('adCampaigns').find({
    'pricingLock.priceLockedUntil': { $lt: now, $ne: null },
  }).toArray();

  for (const campaign of expiredCampaigns) {
    await db.collection('adCampaigns').updateOne(
      { _id: campaign._id },
      {
        $set: {
          'pricingLock.priceLockedUntil': null,
          updatedAt: now,
        },
      }
    );
  }

  return { expired: expiredCampaigns.length };
}

/**
 * Auto-expires non-recurring event campaigns past their event date.
 * @param {Db} db
 * @param {Date} now
 * @returns {Promise<number>} count of expired campaigns
 */
async function processEventExpirations(db, now) {
  const expiredEvents = await db.collection('adCampaigns').find({
    isEvent: true,
    isRecurring: { $ne: true },
    eventDate: { $lt: now },
    status: 'active',
  }).toArray();

  for (const campaign of expiredEvents) {
    await db.collection('adCampaigns').updateOne(
      { _id: campaign._id },
      { $set: { status: 'completed', updatedAt: now } }
    );
    await db.collection('adSubmissions').updateOne(
      { _id: campaign.submissionId },
      { $set: { status: 'completed', updatedAt: now } }
    );

    // Clean up adTargeting records
    await db.collection('adTargeting').deleteMany({ campaignId: campaign._id });

    try {
      await issueLoyaltyDiscountOnCampaignCompletion(campaign._id);
    } catch (err) {
      console.warn('[campaignLifecycle] loyalty discount (event expiry) failed', campaign._id?.toString?.(), err.message);
    }
  }

  return expiredEvents.length;
}

/**
 * Checks for active campaigns expiring within 3 days and sends a notification.
 * Sets expiryNotificationSent flag to prevent duplicate emails.
 * @returns {Promise<number>} count of notifications sent
 */
async function checkExpiringCampaigns() {
  const db = getDb();
  const now = new Date();
  const threeDaysFromNow = new Date(now);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  const campaigns = await db.collection('adCampaigns').find({
    status: 'active',
    endDate: { $gte: now, $lte: threeDaysFromNow },
    expiryNotificationSent: { $ne: true },
  }).toArray();

  let sentCount = 0;
  for (const campaign of campaigns) {
    const adDisplayName = await resolveAdDisplayName(db, campaign.creativeId);
    notifyAdvertiser(campaign.advertiserId, 'campaign_expiring_soon', {
      endDate: campaign.endDate,
      adDisplayName,
    });
    await db.collection('adCampaigns').updateOne(
      { _id: campaign._id },
      { $set: { expiryNotificationSent: true } }
    );
    sentCount++;
  }

  return sentCount;
}

/**
 * Issues 20% next-campaign codes for active paid campaigns that have reached the halfway point
 * of their scheduled run (so advertisers can book back-to-back without waiting for completion).
 * @returns {Promise<number>} count of new codes issued this run
 */
async function checkMidCampaignLoyaltyDiscounts() {
  return processMidCampaignLoyaltyDiscounts();
}

module.exports = {
  activateCampaign,
  processLifecycleTransitions,
  processIntroExpirations,
  checkExpiringCampaigns,
  checkMidCampaignLoyaltyDiscounts,
};
