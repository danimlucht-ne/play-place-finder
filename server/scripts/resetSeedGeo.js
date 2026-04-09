const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { MongoClient } = require("mongodb");
const { resolveMongoDbName } = require("../src/resolveMongoDbName");

function parseArgs(argv) {
  const args = {
    lat: null,
    lng: null,
    radiusMiles: null,
    regionKey: null,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--lat") args.lat = Number(argv[++i]);
    else if (a === "--lng") args.lng = Number(argv[++i]);
    else if (a === "--radius-miles") args.radiusMiles = Number(argv[++i]);
    else if (a === "--regionKey") args.regionKey = String(argv[++i]);
  }
  return args;
}

async function main() {
  const { lat, lng, radiusMiles, regionKey, dryRun } = parseArgs(process.argv);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusMiles)) {
    throw new Error("Usage: node scripts/resetSeedGeo.js --lat <num> --lng <num> --radius-miles <num> [--regionKey <key>] [--dry-run]");
  }

  const uri = process.env.MONGODB_URI;
  const dbName = resolveMongoDbName();
  if (!uri) throw new Error("Missing MONGODB_URI in server/.env");

  const radiusMeters = radiusMiles * 1609.34;

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // Only delete likely seeded docs:
  // - have googlePlaceId (seeded from Google)
  // - are within radius
  // This avoids deleting user-submitted places.
  const geoFilter = {
    googlePlaceId: { $exists: true, $ne: null },
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
        $maxDistance: radiusMeters,
      },
    },
  };

  const toDelete = await db.collection("playgrounds").find(geoFilter, { projection: { _id: 1, name: 1 } }).toArray();
  console.log(`Matched ${toDelete.length} seeded places for deletion within ${radiusMiles}mi of (${lat}, ${lng}).`);

  if (toDelete.length > 0) {
    toDelete.slice(0, 20).forEach((p) => console.log(` - ${p.name} (${p._id})`));
    if (toDelete.length > 20) console.log(` ... and ${toDelete.length - 20} more`);
  }

  if (!dryRun && toDelete.length > 0) {
    const ids = toDelete.map((p) => p._id);
    const delRes = await db.collection("playgrounds").deleteMany({ _id: { $in: ids } });
    console.log(`Deleted ${delRes.deletedCount} places.`);
  } else if (dryRun) {
    console.log("[DRY RUN] No deletions performed.");
  }

  if (regionKey) {
    const regionMatch = { regionKey };
    if (!dryRun) {
      const r1 = await db.collection("seeded_regions").deleteMany(regionMatch);
      const r2 = await db.collection("seed_jobs").deleteMany(regionMatch);
      console.log(`Cleared seeded_regions: ${r1.deletedCount}, seed_jobs: ${r2.deletedCount} for regionKey=${regionKey}.`);
    } else {
      const c1 = await db.collection("seeded_regions").countDocuments(regionMatch);
      const c2 = await db.collection("seed_jobs").countDocuments(regionMatch);
      console.log(`[DRY RUN] Would clear seeded_regions=${c1}, seed_jobs=${c2} for regionKey=${regionKey}.`);
    }
  }

  await client.close();
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exitCode = 1;
});

