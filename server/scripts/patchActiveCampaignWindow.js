/**
 * Bulk-set campaign window for all **active** or **scheduled** ad campaigns (and linked submission starts).
 *
 * Default dates (override with env):
 *   START_CALENDAR=2026-04-15  END_CALENDAR=2026-06-15
 *
 * Usage (from server/):
 *   node scripts/patchActiveCampaignWindow.js           # dry-run: list matches only
 *   node scripts/patchActiveCampaignWindow.js --apply   # perform updates
 *
 * Requires MONGODB_URI and server/.env (see other scripts).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');

const APPLY = process.argv.includes('--apply');

const START_CAL = (process.env.START_CALENDAR || '2026-04-15').trim();
const END_CAL = (process.env.END_CALENDAR || '2026-06-15').trim();

function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`Invalid calendar date (expected YYYY-MM-DD): ${ymd}`);
  return { y: +m[1], mo: +m[2], d: +m[3] };
}

/** Start of calendar day UTC (matches typical ISO date-only semantics). */
function utcStartOfDay(y, mo, d) {
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}

/** End of calendar day UTC so adServing `endDate >= now` stays true through that day. */
function utcEndOfDay(y, mo, d) {
  return new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
}

/**
 * Align with campaignLifecycleService: scheduled if start day (local midnight) is after today (local midnight).
 * For bulk ops we use UTC calendar days for consistency with stored ISO strings.
 */
function nextStatusForWindow(startDate, endDate, now = new Date()) {
  const sd = new Date(startDate.getTime());
  const ed = new Date(endDate.getTime());
  const t0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const s0 = Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), sd.getUTCDate());
  const e0 = Date.UTC(ed.getUTCFullYear(), ed.getUTCMonth(), ed.getUTCDate());
  if (s0 > t0) return 'scheduled';
  if (e0 < t0) return 'completed';
  return 'active';
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = resolveMongoDbName();
  if (!uri) {
    console.error('Missing MONGODB_URI (set in server/.env)');
    process.exit(1);
  }

  const { y: ys, mo: ms, d: ds } = parseYmd(START_CAL);
  const { y: ye, mo: me, d: de } = parseYmd(END_CAL);
  const startDate = utcStartOfDay(ys, ms, ds);
  const endDate = utcEndOfDay(ye, me, de);
  if (startDate > endDate) {
    console.error('START_CALENDAR must be on or before END_CALENDAR');
    process.exit(1);
  }

  const filter = { status: { $in: ['active', 'scheduled'] } };

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const campaigns = await db.collection('adCampaigns').find(filter).toArray();
  console.log(`Matched ${campaigns.length} campaign(s) with status active|scheduled`);
  if (campaigns.length === 0) {
    await client.close();
    return;
  }

  const submissionIds = [...new Set(campaigns.map((c) => c.submissionId).filter(Boolean))];

  for (const c of campaigns.slice(0, 50)) {
    console.log(
      `- ${String(c._id)}  status=${c.status}  placement=${c.placement || ''}  ` +
        `current ${(c.startDateCalendar || '').slice(0, 10)} → ${(c.endDateCalendar || '').slice(0, 10)}`,
    );
  }
  if (campaigns.length > 50) {
    console.log(`  … and ${campaigns.length - 50} more`);
  }

  console.log(
    `\nWill set startDate=${startDate.toISOString()} endDate=${endDate.toISOString()} ` +
      `startDateCalendar=${START_CAL} endDateCalendar=${END_CAL}`,
  );
  console.log('Per campaign, status will be set to active | scheduled | completed from UTC calendar vs today.');

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.');
    await client.close();
    return;
  }

  const now = new Date();
  let campaignsUpdated = 0;
  for (const c of campaigns) {
    const status = nextStatusForWindow(startDate, endDate, now);
    const r = await db.collection('adCampaigns').updateOne(
      { _id: c._id },
      {
        $set: {
          startDate,
          endDate,
          startDateCalendar: START_CAL,
          endDateCalendar: END_CAL,
          status,
          updatedAt: now,
        },
      },
    );
    campaignsUpdated += r.modifiedCount;
  }

  let submissionsUpdated = 0;
  if (submissionIds.length > 0) {
    const r = await db.collection('adSubmissions').updateMany(
      { _id: { $in: submissionIds } },
      {
        $set: {
          startDate,
          startDateCalendar: START_CAL,
          updatedAt: now,
        },
      },
    );
    submissionsUpdated = r.modifiedCount;
  }

  console.log(`\nDone. adCampaigns updated: ${campaignsUpdated} / ${campaigns.length}`);
  console.log(`adSubmissions touched (matched): ${submissionsUpdated} (submissionIds: ${submissionIds.length})`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
