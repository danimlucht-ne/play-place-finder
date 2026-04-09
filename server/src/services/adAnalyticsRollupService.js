const { getDb } = require('../database');
const { ObjectId } = require('mongodb');

function toCampaignId(value) {
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  return value;
}

function ymdFromDate(date) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

function dayBoundsUtc(ymd) {
  const start = new Date(`${ymd}T00:00:00.000Z`);
  const end = new Date(`${ymd}T23:59:59.999Z`);
  return { start, end };
}

async function rollupCampaignDay(campaignIdValue, ymd = ymdFromDate(new Date())) {
  const db = getDb();
  const campaignId = toCampaignId(campaignIdValue);
  const { start, end } = dayBoundsUtc(ymd);

  const rows = await db.collection('adEvents').aggregate([
    {
      $match: {
        campaignId,
        timestamp: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        visitors: { $addToSet: '$visitorKey' },
      },
    },
  ]).toArray();

  const impressionRow = rows.find((r) => r._id === 'impression');
  const clickRow = rows.find((r) => r._id === 'click');
  const impressions = impressionRow?.count || 0;
  const clicks = clickRow?.count || 0;
  const uniqueReach = (impressionRow?.visitors || []).filter(Boolean).length;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const frequency = uniqueReach > 0 ? impressions / uniqueReach : 0;

  const doc = {
    campaignId,
    ymd,
    impressions,
    clicks,
    ctr,
    uniqueReach,
    frequency,
    updatedAt: new Date(),
  };

  await db.collection('adCampaignDailyStats').updateOne(
    { campaignId, ymd },
    { $set: doc, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );

  return doc;
}

async function rollupRecentCampaignDays(daysBack = 2, now = new Date()) {
  const db = getDb();
  const days = [];
  for (let i = Math.max(0, daysBack - 1); i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(ymdFromDate(d));
  }

  const earliest = dayBoundsUtc(days[0]).start;
  const campaigns = await db.collection('adCampaigns').find({
    startDate: { $lte: now },
    endDate: { $gte: earliest },
    status: { $in: ['active', 'completed'] },
  }).project({ _id: 1, startDate: 1, endDate: 1 }).toArray();

  let rolledUp = 0;
  for (const campaign of campaigns) {
    for (const ymd of days) {
      const { start, end } = dayBoundsUtc(ymd);
      if (campaign.startDate && campaign.startDate > end) continue;
      if (campaign.endDate && campaign.endDate < start) continue;
      await rollupCampaignDay(campaign._id, ymd);
      rolledUp += 1;
    }
  }

  return { campaigns: campaigns.length, days: days.length, rolledUp };
}

module.exports = {
  rollupCampaignDay,
  rollupRecentCampaignDays,
  ymdFromDate,
  dayBoundsUtc,
};
