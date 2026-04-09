const { getDb } = require('../database');
const { regionKeyCandidates } = require('../utils/regionKeyForAds');
const { ObjectId } = require('mongodb');

const VALID_EVENT_TYPES = ['impression', 'click'];

function toCampaignId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  return value;
}

function campaignIdsEqual(a, b) {
  if (!a || !b) return false;
  return String(a) === String(b);
}

async function validatePaidEvent(db, event, now) {
  if (!event.campaignId) {
    return { campaign: null };
  }

  const campaignId = toCampaignId(event.campaignId);
  const campaign = await db.collection('adCampaigns').findOne({
    _id: campaignId,
    status: 'active',
    startDate: { $lte: now },
    endDate: { $gte: now },
  });
  if (!campaign) {
    const err = new Error('Campaign is not active or cannot receive ad events');
    err.statusCode = 400;
    throw err;
  }

  if (event.adId && !campaignIdsEqual(event.adId, campaign._id)) {
    const err = new Error('adId does not match campaignId');
    err.statusCode = 400;
    throw err;
  }

  const targeting = await db.collection('adTargeting').findOne({
    campaignId: campaign._id,
    cityId: { $in: regionKeyCandidates(event.cityId) },
    placement: event.placement,
  });
  if (!targeting) {
    const err = new Error('Campaign is not targeted to this city and placement');
    err.statusCode = 400;
    throw err;
  }

  return { campaign };
}

/**
 * Records an ad event (impression or click).
 * Deduplicates impressions: same user + same ad within 1-hour window.
 * @param {Object} event — { type, adId, campaignId, cityId, placement, userId? }
 * @returns {Promise<void>}
 */
async function recordEvent(event) {
  const db = getDb();
  const now = new Date();
  if (!VALID_EVENT_TYPES.includes(event.type)) {
    const err = new Error('type must be impression or click');
    err.statusCode = 400;
    throw err;
  }

  const { campaign } = await validatePaidEvent(db, event, now);
  const campaignId = campaign?._id || toCampaignId(event.campaignId);
  const identity = event.visitorKey || event.userId || null;
  // Skip impression recording for fully anonymous events (no dedup possible)
  if (event.type === 'impression' && !identity) {
    return;
  }
  const doc = {
    ...event,
    campaignId,
    userId: event.userId || null,
    visitorKey: event.visitorKey || null,
    timestamp: now,
  };

  // Deduplicate impressions: same known visitor + same ad within 1 hour.
  if (event.type === 'impression' && identity) {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const dedupeQuery = {
      type: 'impression',
      adId: event.adId,
      timestamp: { $gte: oneHourAgo },
    };
    if (event.visitorKey) dedupeQuery.visitorKey = event.visitorKey;
    else dedupeQuery.userId = event.userId;

    const existing = await db.collection('adEvents').findOne(dedupeQuery);
    if (existing) return; // skip duplicate
  }

  await db.collection('adEvents').insertOne(doc);

  // Update denormalized counters on campaign
  if (campaignId) {
    const incField = event.type === 'impression' ? 'impressions' : 'clicks';
    await db.collection('adCampaigns').updateOne(
      { _id: campaignId },
      { $inc: { [incField]: 1 } }
    );
  }
}

/**
 * Gets aggregated analytics for a campaign.
 * @param {string} campaignId
 * @param {Date} [startDate] — optional start of date range
 * @param {Date} [endDate] — optional end of date range
 * @returns {Promise<{impressions: number, clicks: number, ctr: number, daily: Array}>}
 */
async function getCampaignAnalytics(campaignId, startDate, endDate) {
  const db = getDb();
  const normalizedCampaignId = toCampaignId(campaignId);

  const matchStage = {
    campaignId: normalizedCampaignId,
  };
  if (startDate || endDate) {
    matchStage.timestamp = {};
    if (startDate) matchStage.timestamp.$gte = startDate;
    if (endDate) matchStage.timestamp.$lte = endDate;
  }

  // Aggregate totals
  const totalPipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
      },
    },
  ];

  const totals = await db.collection('adEvents').aggregate(totalPipeline).toArray();
  const impressions = totals.find(t => t._id === 'impression')?.count || 0;
  const clicks = totals.find(t => t._id === 'click')?.count || 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;

  const uniqueReachPipeline = [
    { $match: { ...matchStage, type: 'impression', visitorKey: { $ne: null } } },
    { $group: { _id: '$visitorKey' } },
    { $count: 'count' },
  ];
  const uniqueReachRows = await db.collection('adEvents').aggregate(uniqueReachPipeline).toArray();
  const uniqueReach = uniqueReachRows[0]?.count || 0;

  // Daily breakdown
  const dailyPipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          type: '$type',
        },
        count: { $sum: 1 },
        visitors: { $addToSet: '$visitorKey' },
      },
    },
    { $sort: { '_id.date': 1 } },
  ];

  const dailyRaw = await db.collection('adEvents').aggregate(dailyPipeline).toArray();

  // Reshape daily data into { date, impressions, clicks, ctr }
  const dailyMap = new Map();
  for (const row of dailyRaw) {
    const date = row._id.date;
    if (!dailyMap.has(date)) {
      dailyMap.set(date, { date, impressions: 0, clicks: 0 });
    }
    const entry = dailyMap.get(date);
    if (row._id.type === 'impression') entry.impressions = row.count;
    if (row._id.type === 'click') entry.clicks = row.count;
    if (row._id.type === 'impression') {
      entry.uniqueReach = (row.visitors || []).filter(Boolean).length;
    }
  }

  const rawDaily = Array.from(dailyMap.values()).map(d => ({
    ...d,
    uniqueReach: d.uniqueReach || 0,
    frequency: d.uniqueReach > 0 ? d.impressions / d.uniqueReach : 0,
    ctr: d.impressions > 0 ? d.clicks / d.impressions : 0,
  }));

  let daily = rawDaily;
  const rollupFilter = { campaignId: normalizedCampaignId };
  if (startDate || endDate) {
    rollupFilter.ymd = {};
    if (startDate) rollupFilter.ymd.$gte = startDate.toISOString().slice(0, 10);
    if (endDate) rollupFilter.ymd.$lte = endDate.toISOString().slice(0, 10);
  }
  const rollups = await db.collection('adCampaignDailyStats')
    .find(rollupFilter)
    .sort({ ymd: 1 })
    .toArray();

  if (rollups.length > 0) {
    const rollupDays = new Set(rollups.map((r) => r.ymd));
    daily = [
      ...rollups.map((r) => ({
        date: r.ymd,
        impressions: r.impressions || 0,
        clicks: r.clicks || 0,
        uniqueReach: r.uniqueReach || 0,
        frequency: r.frequency || 0,
        ctr: r.ctr || ((r.impressions || 0) > 0 ? (r.clicks || 0) / r.impressions : 0),
      })),
      ...rawDaily.filter((d) => !rollupDays.has(d.date)),
    ].sort((a, b) => a.date.localeCompare(b.date));
  }

  const mergedImpressions = daily.reduce((sum, d) => sum + (d.impressions || 0), 0);
  const mergedClicks = daily.reduce((sum, d) => sum + (d.clicks || 0), 0);
  const mergedReach = daily.reduce((sum, d) => sum + (d.uniqueReach || 0), 0);

  return {
    impressions: rollups.length > 0 ? mergedImpressions : impressions,
    clicks: rollups.length > 0 ? mergedClicks : clicks,
    ctr: (rollups.length > 0 ? mergedImpressions : impressions) > 0
      ? (rollups.length > 0 ? mergedClicks : clicks) / (rollups.length > 0 ? mergedImpressions : impressions)
      : ctr,
    uniqueReach: rollups.length > 0 ? mergedReach : uniqueReach,
    frequency: (rollups.length > 0 ? mergedReach : uniqueReach) > 0
      ? (rollups.length > 0 ? mergedImpressions : impressions) / (rollups.length > 0 ? mergedReach : uniqueReach)
      : 0,
    daily,
  };
}

module.exports = {
  recordEvent,
  getCampaignAnalytics,
  validatePaidEvent,
};
