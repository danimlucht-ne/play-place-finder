const { getDb } = require('../database');
const { regionKeyCandidates } = require('../utils/regionKeyForAds');
const { ObjectId } = require('mongodb');

const VALID_EVENT_TYPES = ['impression', 'click'];

/** Client tracking placement for map pins; inventory still uses [inline_listing] in adTargeting. */
const MAP_PIN_TRACKING_PLACEMENT = 'map_sponsored_pin';

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

function targetingPlacementFilter(placement) {
  if (placement === MAP_PIN_TRACKING_PLACEMENT) {
    return { $in: [MAP_PIN_TRACKING_PLACEMENT, 'inline_listing'] };
  }
  return placement;
}

/** Rows from $group _id: { date, type }, with count + visitors — same shape as daily pipeline output. */
function buildRawDailyList(dailyRaw) {
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
  return Array.from(dailyMap.values()).map(d => ({
    ...d,
    uniqueReach: d.uniqueReach || 0,
    frequency: d.uniqueReach > 0 ? d.impressions / d.uniqueReach : 0,
    ctr: d.impressions > 0 ? d.clicks / d.impressions : 0,
  }));
}

function mergeRollupDaysIntoRawDaily(rawDaily, rollups) {
  if (!rollups.length) return rawDaily;
  const rollupDays = new Set(rollups.map((r) => r.ymd));
  return [
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

async function validatePaidEvent(db, event, now) {
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
    placement: targetingPlacementFilter(event.placement),
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
 * Requires campaignId (24-hex ObjectId). Validates active campaign, targeting, and adId match.
 * Impressions are deduped per visitorKey (preferred) or userId + campaign within a 1h window
 * (any placement, including map pin vs list), using adImpressionDedupes to avoid double-count races.
 * Impressions with no visitorKey and no userId are skipped (cannot dedupe or attribute).
 * @param {Object} event — { type, adId, campaignId, cityId, placement, userId?, visitorKey? }
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

  if (!event.campaignId || !ObjectId.isValid(String(event.campaignId))) {
    const err = new Error('campaignId is required and must be a valid ObjectId');
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

  if (event.type === 'impression' && identity) {
    const hourBucket = Math.floor(now.getTime() / (60 * 60 * 1000));
    const dedupeId = event.visitorKey
      ? `v:${event.visitorKey}:${String(campaignId)}:${hourBucket}`
      : `u:${event.userId}:${String(campaignId)}:${hourBucket}`;
    try {
      await db.collection('adImpressionDedupes').insertOne({
        _id: dedupeId,
        campaignId,
        at: now,
      });
    } catch (err) {
      if (err && err.code === 11000) return;
      throw err;
    }
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
  const rawDaily = buildRawDailyList(dailyRaw);

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
    daily = mergeRollupDaysIntoRawDaily(rawDaily, rollups);
  }

  const mergedImpressions = daily.reduce((sum, d) => sum + (d.impressions || 0), 0);
  const mergedClicks = daily.reduce((sum, d) => sum + (d.clicks || 0), 0);
  const mergedReach = daily.reduce((sum, d) => sum + (d.uniqueReach || 0), 0);

  const { byPlacement, byCity } = await getCampaignDimensionBreakdowns(db, matchStage);

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
    byPlacement,
    byCity,
  };
}

/**
 * Per-placement and per-city (region key) event counts for advertiser breakdown tables / charts.
 */
async function getCampaignDimensionBreakdowns(db, matchStage) {
  const typeCountRows = await db.collection('adEvents').aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { dim: { $ifNull: ['$placement', ''] }, type: '$type' },
        count: { $sum: 1 },
      },
    },
  ]).toArray();

  const byPl = new Map();
  for (const row of typeCountRows) {
    const key = String(row._id.dim || '').trim() || 'unknown';
    if (!byPl.has(key)) byPl.set(key, { impressions: 0, clicks: 0 });
    const m = byPl.get(key);
    if (row._id.type === 'impression') m.impressions = row.count;
    if (row._id.type === 'click') m.clicks = row.count;
  }
  const byPlacement = Array.from(byPl.entries())
    .map(([placement, v]) => ({
      placement,
      impressions: v.impressions,
      clicks: v.clicks,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
    }))
    .sort((a, b) => b.impressions - a.impressions);

  const cityTypeRows = await db.collection('adEvents').aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { city: { $ifNull: ['$cityId', ''] }, type: '$type' },
        count: { $sum: 1 },
      },
    },
  ]).toArray();

  const byCityMap = new Map();
  for (const row of cityTypeRows) {
    const key = String(row._id.city || '').trim() || 'unknown';
    if (!byCityMap.has(key)) byCityMap.set(key, { impressions: 0, clicks: 0 });
    const m = byCityMap.get(key);
    if (row._id.type === 'impression') m.impressions = row.count;
    if (row._id.type === 'click') m.clicks = row.count;
  }
  const byCity = Array.from(byCityMap.entries())
    .map(([cityId, v]) => ({
      cityId,
      impressions: v.impressions,
      clicks: v.clicks,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
    }))
    .sort((a, b) => b.impressions - a.impressions);

  return { byPlacement, byCity };
}

/**
 * List-endpoint metrics: merged impressions/clicks/ctr for many campaigns in few DB round-trips.
 * @param {Array<{_id: import('mongodb').ObjectId, startDate?: Date, endDate?: Date}>} campaigns
 * @returns {Promise<Map<string, { impressions: number, clicks: number, ctr: number }>>} keys = campaign id hex
 */
async function getCampaignListMetricsBatch(campaigns) {
  const out = new Map();
  if (!campaigns.length) return out;
  const db = getDb();

  const matchOr = campaigns.map((c) => {
    const cond = { campaignId: c._id };
    const ts = {};
    if (c.startDate) ts.$gte = c.startDate;
    if (c.endDate) ts.$lte = c.endDate;
    if (Object.keys(ts).length) cond.timestamp = ts;
    return cond;
  });

  const totalsRows = await db.collection('adEvents').aggregate([
    { $match: { $or: matchOr } },
    { $group: { _id: { cid: '$campaignId', typ: '$type' }, count: { $sum: 1 } } },
  ]).toArray();

  const rawTotals = new Map();
  for (const row of totalsRows) {
    const cid = String(row._id.cid);
    if (!rawTotals.has(cid)) rawTotals.set(cid, { impressions: 0, clicks: 0 });
    const m = rawTotals.get(cid);
    if (row._id.typ === 'impression') m.impressions = row.count;
    if (row._id.typ === 'click') m.clicks = row.count;
  }

  const dailyRows = await db.collection('adEvents').aggregate([
    { $match: { $or: matchOr } },
    {
      $group: {
        _id: {
          cid: '$campaignId',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          type: '$type',
        },
        count: { $sum: 1 },
        visitors: { $addToSet: '$visitorKey' },
      },
    },
  ]).toArray();

  const dailyByCid = new Map();
  for (const row of dailyRows) {
    const cid = String(row._id.cid);
    if (!dailyByCid.has(cid)) dailyByCid.set(cid, []);
    dailyByCid.get(cid).push({
      _id: { date: row._id.date, type: row._id.type },
      count: row.count,
      visitors: row.visitors,
    });
  }

  const rollupOr = campaigns.map((c) => {
    const cond = { campaignId: c._id };
    if (c.startDate || c.endDate) {
      cond.ymd = {};
      if (c.startDate) cond.ymd.$gte = c.startDate.toISOString().slice(0, 10);
      if (c.endDate) cond.ymd.$lte = c.endDate.toISOString().slice(0, 10);
    }
    return cond;
  });
  const rollupRows = await db.collection('adCampaignDailyStats').find({ $or: rollupOr }).toArray();
  const rollupByCid = new Map();
  for (const r of rollupRows) {
    const cid = String(r.campaignId);
    if (!rollupByCid.has(cid)) rollupByCid.set(cid, []);
    rollupByCid.get(cid).push(r);
  }

  for (const c of campaigns) {
    const idStr = String(c._id);
    const rollups = rollupByCid.get(idStr) || [];
    rollups.sort((a, b) => a.ymd.localeCompare(b.ymd));
    const rt = rawTotals.get(idStr) || { impressions: 0, clicks: 0 };

    if (rollups.length === 0) {
      out.set(idStr, {
        impressions: rt.impressions,
        clicks: rt.clicks,
        ctr: rt.impressions > 0 ? rt.clicks / rt.impressions : 0,
      });
      continue;
    }

    const cidDailyRaw = dailyByCid.get(idStr) || [];
    const rawDaily = buildRawDailyList(cidDailyRaw);
    const daily = mergeRollupDaysIntoRawDaily(rawDaily, rollups);
    const mergedImpressions = daily.reduce((sum, d) => sum + (d.impressions || 0), 0);
    const mergedClicks = daily.reduce((sum, d) => sum + (d.clicks || 0), 0);
    out.set(idStr, {
      impressions: mergedImpressions,
      clicks: mergedClicks,
      ctr: mergedImpressions > 0 ? mergedClicks / mergedImpressions : 0,
    });
  }

  return out;
}

module.exports = {
  recordEvent,
  getCampaignAnalytics,
  getCampaignListMetricsBatch,
  validatePaidEvent,
};
