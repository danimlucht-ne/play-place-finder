/**
 * Backfill playgrounds with googleRaw + normalized location fields.
 * Uses Place Details + optional reverse geocode (via normalizePlaygroundFromGoogleDetails).
 *
 * Usage (from server/):
 *   node scripts/migratePlaygroundLocationNormalization.js [--dry-run] [--limit N]
 *
 * Logs playground _ids with no acceptable cityDisplay after processing.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');
const {
  normalizePlaygroundFromGoogleDetails,
  NORMALIZATION_VERSION,
} = require('../src/services/placeLocationNormalizationService');
const {
  fetchPlaceDetails,
  resolveGooglePlaceIdForDetails,
} = require('../src/services/seedOrchestratorService');

function parseArgs() {
  const dryRun = process.argv.includes('--dry-run');
  let limit = Infinity;
  const li = process.argv.indexOf('--limit');
  if (li >= 0 && process.argv[li + 1]) {
    limit = parseInt(process.argv[li + 1], 10);
    if (Number.isNaN(limit)) limit = Infinity;
  }
  return { dryRun, limit };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = resolveMongoDbName();
  const { dryRun, limit } = parseArgs();
  if (!uri) throw new Error('Missing MONGODB_URI');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const filter = {
    archivedAt: { $exists: false },
    $or: [
      { 'admin.normalizationVersion': { $ne: NORMALIZATION_VERSION } },
      { admin: { $exists: false } },
      { 'normalized.cityDisplay': { $exists: false } },
    ],
  };

  const cursor = db.collection('playgrounds').find(filter);
  let processed = 0;
  const noCity = [];

  for await (const doc of cursor) {
    if (processed >= limit) break;
    const pid = resolveGooglePlaceIdForDetails(doc);
    if (!pid) {
      noCity.push({ _id: String(doc._id), reason: 'no_google_place_id' });
      processed += 1;
      continue;
    }
    const details = await fetchPlaceDetails(pid);
    if (!details) {
      noCity.push({ _id: String(doc._id), reason: 'place_details_failed', googlePlaceId: pid });
      processed += 1;
      await sleep(150);
      continue;
    }
    const lat = doc.location?.coordinates?.[1];
    const lng = doc.location?.coordinates?.[0];
    const pack = await normalizePlaygroundFromGoogleDetails(
      db,
      pid,
      details,
      { lat, lng },
      process.env.GOOGLE_MAPS_API_KEY,
    );
    if (!pack.normalized.cityDisplay) {
      noCity.push({ _id: String(doc._id), reason: 'no_city_display', googlePlaceId: pid });
    }
    if (!dryRun) {
      await db.collection('playgrounds').updateOne(
        { _id: doc._id },
        {
          $set: {
            googleRaw: pack.googleRaw,
            normalized: pack.normalized,
            admin: { ...(doc.admin || {}), ...pack.admin },
            primaryType: (details.types && details.types[0]) || doc.primaryType || null,
            source: doc.source || 'google_places',
            ...(pack.normalized.cityDisplay ? { city: pack.normalized.cityDisplay } : {}),
            ...(pack.normalized.stateCode ? { state: pack.normalized.stateCode } : {}),
            ...(pack.normalized.postalCode ? { zipCode: pack.normalized.postalCode } : {}),
          },
        },
      );
    }
    processed += 1;
    if (processed % 25 === 0) {
      console.log(`… ${processed} playgrounds processed`);
    }
    await sleep(200);
  }

  console.log(JSON.stringify({ processed, dryRun, noCityCount: noCity.length }, null, 2));
  if (noCity.length) {
    console.log('Records without cityDisplay:', JSON.stringify(noCity.slice(0, 200), null, 2));
    if (noCity.length > 200) console.log(`… and ${noCity.length - 200} more`);
  }

  if (!dryRun) {
    const sr = await db.collection('seeded_regions').updateMany(
      { $or: [{ displayCity: { $exists: false } }, { displayCity: '' }, { displayCity: null }] },
      [{ $set: { displayCity: '$city' } }],
    );
    console.log('seeded_regions displayCity backfill:', sr.modifiedCount);
  }

  await client.close();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
