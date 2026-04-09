/**
 * Grid metadata for coverage / staleness (see docs/seeding-overhaul-plan.md).
 * Tile key: `regionKey|latKey|lngKey` with degree buckets (stable id for upserts from playgrounds).
 */

const { getDb } = require('../database');

function envFloat(name, fallback, min, max) {
  const value = parseFloat(process.env[name] || '');
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/** ~5.5 km N–S at mid-latitudes; override with SEED_TILE_DEGREE_STEP. */
function tileDegreeStep() {
  return envFloat('SEED_TILE_DEGREE_STEP', 0.05, 0.001, 1);
}

/**
 * @param {string} regionKey
 * @param {number} lat
 * @param {number} lng
 * @returns {string} Stable string id for the grid cell
 */
function tileKeyForLatLng(regionKey, lat, lng) {
  const step = tileDegreeStep();
  const i = Math.floor(lat / step);
  const j = Math.floor(lng / step);
  const loLat = i * step;
  const loLng = j * step;
  return `${regionKey}|${loLat.toFixed(5)}|${loLng.toFixed(5)}`;
}

function boundsForTileKey(tileKey) {
  const step = tileDegreeStep();
  const parts = String(tileKey).split('|');
  if (parts.length < 3) return null;
  const loLat = parseFloat(parts[1]);
  const loLng = parseFloat(parts[2]);
  if (!Number.isFinite(loLat) || !Number.isFinite(loLng)) return null;
  return {
    sw: { lat: loLat, lng: loLng },
    ne: { lat: loLat + step, lng: loLng + step },
  };
}

/**
 * @param {import('mongodb').Db} [db]
 * @param {string} regionKey
 * @param {number} lat
 * @param {number} lng
 * @param {{ lastRefreshedAt?: Date, source?: string }} [options]
 */
async function upsertTileForLatLng(db, regionKey, lat, lng, options = {}) {
  const database = db || getDb();
  const tileKey = tileKeyForLatLng(regionKey, lat, lng);
  const b = boundsForTileKey(tileKey);
  const now = options.lastRefreshedAt || new Date();
  const update = {
    $set: {
      regionKey,
      tileKey,
      ...(b ? { bounds: b } : {}),
      lastTouchedAt: now,
      ...(options.source ? { lastTouchSource: options.source } : {}),
    },
    $setOnInsert: { createdAt: now, placeCount: 0 },
  };
  if (options.incrementPlaceCount === true) {
    update.$inc = { placeCount: 1 };
  }
  await database.collection('seed_tiles').updateOne(
    { tileKey },
    update,
    { upsert: true },
  );
  return { tileKey };
}

/**
 * One pass over live playgrounds: upsert a tile per point (idempotent; refreshes `lastTouchedAt`).
 * Does not remove tiles when playgrounds are deleted.
 * @param {string} regionKey
 * @param {import('mongodb').Db} [db]
 * @returns {Promise<{ tilesUpserted: number, playgroundsScanned: number }>}
 */
async function backfillTilesFromPlaygrounds(regionKey, db) {
  const database = db || getDb();
  const cursor = database.collection('playgrounds').find(
    { regionKey, 'location.coordinates.0': { $exists: true } },
    { projection: { location: 1 } },
  );
  let playgroundsScanned = 0;
  for await (const p of cursor) {
    const coords = p.location?.coordinates;
    if (!coords || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    playgroundsScanned += 1;
    await upsertTileForLatLng(database, regionKey, lat, lng, {
      lastRefreshedAt: new Date(),
      source: 'backfill_playgrounds',
    });
  }
  const tilesUpserted = await database.collection('seed_tiles').countDocuments({ regionKey });
  return { tilesUpserted, playgroundsScanned };
}

module.exports = {
  tileKeyForLatLng,
  boundsForTileKey,
  tileDegreeStep,
  upsertTileForLatLng,
  backfillTilesFromPlaygrounds,
};
