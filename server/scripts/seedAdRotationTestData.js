/**
 * Inserts test ads + adEvents so you can verify home rotation, inline sampling, and analytics.
 *
 * Requires at least one advertiser in the target region (create via app or admin).
 *
 * Usage (from server/):
 *   node scripts/seedAdRotationTestData.js --regionKey=omaha-ne           # dry-run
 *   node scripts/seedAdRotationTestData.js --regionKey=omaha-ne --apply  # write
 *   node scripts/seedAdRotationTestData.js --regionKey=omaha-ne --remove # delete this seed only
 *
 * Creates per region (when --apply):
 *   - 5 active featured_home campaigns (+ creatives + adTargeting) — home carousel rotation
 *   - 5 active inline_listing campaigns — search inline rotation
 *   - 5 active event-style inline_listing campaigns (isEvent, future eventDate)
 *   - 5 adEvents type=impression + 5 type=click (distinct synthetic userIds) on the first featured campaign
 *
 * All rows are tagged with seedTag: "ad-rotation-test-v1" for --remove.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');

const SEED_TAG = 'ad-rotation-test-v1';
const N = 5;

function argVal(name) {
  const p = process.argv.find((a) => a.startsWith(`${name}=`));
  return p ? p.slice(name.length + 1).trim().toLowerCase() : null;
}

const regionKey = argVal('--regionKey');
const APPLY = process.argv.includes('--apply');
const REMOVE = process.argv.includes('--remove');

if (!regionKey) {
  console.error('Usage: node scripts/seedAdRotationTestData.js --regionKey=omaha-ne [--apply | --remove]');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
const dbName = resolveMongoDbName();
if (!uri) {
  console.error('Missing MONGODB_URI in server/.env');
  process.exit(1);
}

async function removeSeed(db) {
  const campaigns = await db.collection('adCampaigns').find({ seedTag: SEED_TAG }).toArray();
  if (campaigns.length === 0) {
    console.log('No seeded campaigns found for', SEED_TAG);
    return;
  }
  const ids = campaigns.map((c) => c._id);
  const creativeIds = campaigns.map((c) => c.creativeId).filter(Boolean);
  const r1 = await db.collection('adTargeting').deleteMany({ campaignId: { $in: ids } });
  const r2 = await db.collection('adEvents').deleteMany({
    $or: [
      { campaignId: { $in: ids } },
      { userId: { $regex: /^seed-ad-test-/ } },
    ],
  });
  const r3 = await db.collection('adCampaigns').deleteMany({ _id: { $in: ids } });
  const r4 = await db.collection('adCreatives').deleteMany({ _id: { $in: creativeIds } });
  console.log('Removed adTargeting:', r1.deletedCount, 'adEvents:', r2.deletedCount, 'campaigns:', r3.deletedCount, 'creatives:', r4.deletedCount);
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  if (REMOVE) {
    await removeSeed(db);
    await client.close();
    return;
  }

  const advertiser = await db.collection('advertisers').findOne({ regionKey });
  if (!advertiser) {
    console.error(`No advertiser with regionKey="${regionKey}". Create an advertiser in that city first.`);
    await client.close();
    process.exit(1);
  }

  const existing = await db.collection('adCampaigns').countDocuments({ seedTag: SEED_TAG, cityId: regionKey });
  if (existing > 0 && APPLY) {
    console.error(`Seed already present (${existing} campaigns). Run with --remove first, or skip.`);
    await client.close();
    process.exit(1);
  }

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 1);
  const end = new Date(now);
  end.setDate(end.getDate() + 60);
  const eventDay = new Date(now);
  eventDay.setDate(eventDay.getDate() + 14);

  const plan = [];

  for (let i = 0; i < N; i += 1) {
    plan.push({
      placement: 'featured_home',
      label: `featured-${i + 1}`,
      isEvent: false,
      headline: `TEST ROTATION Featured ${i + 1}`,
    });
  }
  for (let i = 0; i < N; i += 1) {
    plan.push({
      placement: 'inline_listing',
      label: `inline-${i + 1}`,
      isEvent: false,
      headline: `TEST ROTATION Inline ${i + 1}`,
    });
  }
  for (let i = 0; i < N; i += 1) {
    plan.push({
      placement: 'inline_listing',
      label: `event-${i + 1}`,
      isEvent: true,
      headline: `TEST ROTATION Event ${i + 1}`,
    });
  }

  if (!APPLY) {
    console.log(`[dry-run] Would insert ${plan.length} campaigns (+ creatives + targeting) and ${N * 2} adEvents for regionKey=${regionKey}, advertiserId=${advertiser._id}`);
    console.log('Run with --apply to write.');
    await client.close();
    return;
  }

  const campaignIds = [];

  for (const p of plan) {
    const creative = {
      submissionId: null,
      advertiserId: advertiser._id,
      headline: p.headline,
      body: 'Synthetic creative for rotation / analytics testing. Safe to delete with --remove.',
      imageUrl: null,
      ctaText: 'Learn more',
      ctaUrl: 'https://example.com',
      businessName: advertiser.businessName || 'Test Business',
      businessCategory: advertiser.category || 'other',
      templateType: 'standard',
      status: 'active',
      seedTag: SEED_TAG,
      ...(p.isEvent
        ? {
            eventName: `${p.headline} — Community Night`,
            eventDate: new Date(eventDay),
            eventTime: '6:00 PM',
            isRecurring: false,
            eventLocation: `${advertiser.city || regionKey}`,
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
    const cr = await db.collection('adCreatives').insertOne(creative);
    const creativeId = cr.insertedId;

    const campaign = {
      submissionId: null,
      advertiserId: advertiser._id,
      creativeId,
      status: 'active',
      placement: p.placement,
      startDate: start,
      endDate: end,
      impressions: 0,
      clicks: 0,
      cityId: regionKey,
      targetedRegionKeys: [regionKey],
      targetingRadiusMiles: 20,
      cityPhaseAtPurchase: 'growth',
      pricingLock: null,
      isEvent: p.isEvent,
      ...(p.isEvent ? { eventDate: new Date(eventDay), isRecurring: false } : {}),
      seedTag: SEED_TAG,
      createdAt: now,
      updatedAt: now,
    };
    const cam = await db.collection('adCampaigns').insertOne(campaign);
    const campaignId = cam.insertedId;
    campaignIds.push(campaignId);

    await db.collection('adTargeting').insertOne({
      campaignId,
      cityId: regionKey,
      placement: p.placement,
      priority: 1,
      createdAt: now,
    });
  }

  const featuredFirst = campaignIds[0];
  const events = [];
  for (let i = 0; i < N; i += 1) {
    events.push({
      type: 'impression',
      adId: featuredFirst,
      campaignId: featuredFirst,
      cityId: regionKey,
      placement: 'featured_home',
      userId: `seed-ad-test-imp-${i}`,
      timestamp: new Date(now.getTime() - (N - i) * 60000),
    });
  }
  for (let i = 0; i < N; i += 1) {
    events.push({
      type: 'click',
      adId: featuredFirst,
      campaignId: featuredFirst,
      cityId: regionKey,
      placement: 'featured_home',
      userId: `seed-ad-test-clk-${i}`,
      timestamp: new Date(now.getTime() - (N - i) * 120000),
    });
  }
  await db.collection('adEvents').insertMany(events);

  await db.collection('adCampaigns').updateOne(
    { _id: featuredFirst },
    { $inc: { impressions: N, clicks: N } },
  );

  console.log(`Inserted ${plan.length} campaigns, targeting rows, ${events.length} adEvents, bumped counters on first featured campaign.`);
  console.log('Remove with: node scripts/seedAdRotationTestData.js --regionKey=' + regionKey + ' --remove');

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
