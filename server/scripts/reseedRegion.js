/**
 * Wipes all seeded data for one or more regions and triggers a fresh seed.
 *
 * Usage:
 *   node scripts/reseedRegion.js omaha-ne lincoln-ne           # dry-run
 *   node scripts/reseedRegion.js omaha-ne lincoln-ne --apply   # wipe + reseed
 *
 * What gets deleted per region:
 *   - playgrounds          (where regionKey matches)
 *   - seed_review_queue    (where regionKey matches)
 *   - seed_jobs            (where regionKey matches)
 *   - city_advertising_status (where regionKey matches)
 *   - seeded_regions       (the region record itself — allows re-seed)
 *
 * After wiping, hits POST /api/seed/hybrid-search with the region's center coords
 * to kick off a fresh seed. Requires SERVER_BASE_URL and an admin Firebase token.
 *
 * Set ADMIN_TOKEN in .env or pass as env var:
 *   ADMIN_TOKEN=xxx node scripts/reseedRegion.js omaha-ne --apply
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');
const axios = require('axios');

const DRY_RUN = !process.argv.includes('--apply');
const regionKeys = process.argv.slice(2).filter(a => !a.startsWith('--'));

if (regionKeys.length === 0) {
    console.error('Usage: node scripts/reseedRegion.js <regionKey> [<regionKey2> ...] [--apply]');
    console.error('  e.g. node scripts/reseedRegion.js omaha-ne lincoln-ne --apply');
    process.exit(1);
}

// Known center coords for common regions — add more as needed
const REGION_COORDS = {
    'omaha-ne':   { lat: 41.2565, lng: -95.9345 },
    'lincoln-ne': { lat: 40.8136, lng: -96.7026 },
};

async function wipeRegion(db, regionKey, dryRun) {
    const collections = [
        'playgrounds',
        'seed_review_queue',
        'seed_jobs',
        'city_advertising_status',
    ];

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Region: ${regionKey}${dryRun ? '  [DRY RUN]' : ''}`);
    console.log(`${'─'.repeat(50)}`);

    for (const col of collections) {
        const count = await db.collection(col).countDocuments({ regionKey });
        if (count === 0) {
            console.log(`  ${col.padEnd(30)} — nothing to delete`);
            continue;
        }
        if (!dryRun) {
            const result = await db.collection(col).deleteMany({ regionKey });
            console.log(`  ${col.padEnd(30)} deleted ${result.deletedCount}`);
        } else {
            console.log(`  ${col.padEnd(30)} would delete ${count}`);
        }
    }

    // seeded_regions uses regionKey as a field too
    const regionDoc = await db.collection('seeded_regions').findOne({ regionKey });
    if (regionDoc) {
        if (!dryRun) {
            await db.collection('seeded_regions').deleteOne({ regionKey });
            console.log(`  ${'seeded_regions'.padEnd(30)} deleted 1`);
        } else {
            console.log(`  ${'seeded_regions'.padEnd(30)} would delete 1`);
        }
    } else {
        console.log(`  ${'seeded_regions'.padEnd(30)} — not found`);
    }
}

async function triggerReseed(regionKey) {
    const coords = REGION_COORDS[regionKey];
    if (!coords) {
        console.log(`\n⚠️  No coords configured for "${regionKey}" — skipping auto-reseed.`);
        console.log(`   Add it to REGION_COORDS in the script, or trigger manually via the app.`);
        return;
    }

    const baseUrl = (process.env.SERVER_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
    const token = process.env.ADMIN_TOKEN;
    if (!token) {
        console.log(`\n⚠️  ADMIN_TOKEN not set in .env — skipping auto-reseed for ${regionKey}.`);
        console.log(`   Set ADMIN_TOKEN=<firebase_id_token> in server/.env and re-run, or open the app to trigger.`);
        return;
    }

    console.log(`\n🌱 Triggering reseed for ${regionKey} (${coords.lat}, ${coords.lng})...`);
    try {
        const res = await axios.post(
            `${baseUrl}/api/seed/hybrid-search`,
            { lat: coords.lat, lng: coords.lng },
            { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
        );
        console.log(`   ✅ Seed started — status: ${res.data?.status}, regionKey: ${res.data?.regionKey}`);
        if (res.data?.message) console.log(`   ${res.data.message}`);
    } catch (err) {
        const msg = err.response?.data?.error || err.message;
        console.log(`   ❌ Seed request failed: ${msg}`);
        console.log(`   You can trigger it manually by opening the app at those coordinates.`);
    }
}

async function run() {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) { console.error('❌  MONGODB_URI not set in .env'); process.exit(1); }

    const client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db(resolveMongoDbName());

    for (const regionKey of regionKeys) {
        await wipeRegion(db, regionKey, DRY_RUN);
    }

    await client.close();

    if (DRY_RUN) {
        console.log(`\n✅ Dry run complete. Run with --apply to wipe and reseed:`);
        console.log(`   node scripts/reseedRegion.js ${regionKeys.join(' ')} --apply\n`);
        return;
    }

    // Trigger reseeds sequentially (avoid hammering Google Places API in parallel)
    for (const regionKey of regionKeys) {
        await triggerReseed(regionKey);
    }

    console.log('\n✅ Done. Background seed jobs are running — check seed_jobs collection for progress.\n');
    process.exit(0);
}

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
