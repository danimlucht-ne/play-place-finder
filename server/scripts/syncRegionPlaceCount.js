/**
 * Optional: write legacy seeded_regions.placeCount to match active playground rows.
 * Admin GET /admin/regions now uses live counts (regionStatsService); this script is
 * for DB hygiene or tools that still read the stored field.
 *
 * Usage (from server/):
 *   node scripts/syncRegionPlaceCount.js omaha-ne              # dry-run: print counts only
 *   node scripts/syncRegionPlaceCount.js omaha-ne --apply    # write placeCount to seeded_regions
 *   node scripts/syncRegionPlaceCount.js --all                 # dry-run every seeded region
 *   node scripts/syncRegionPlaceCount.js --all --apply
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const ACTIVE = { archivedAt: { $exists: false } };

async function main() {
    const args = process.argv.slice(2).filter((a) => a !== '--apply');
    const apply = process.argv.includes('--apply');
    const allRegions = args.includes('--all');
    const regionKeys = allRegions ? [] : args.filter((a) => a !== '--all');

    if (!allRegions && regionKeys.length === 0) {
        console.error('Usage: node scripts/syncRegionPlaceCount.js <regionKey> [--apply]');
        console.error('       node scripts/syncRegionPlaceCount.js --all [--apply]');
        process.exit(1);
    }

    const { connectToServer, getDb } = require('../src/database');
    await connectToServer();
    const db = getDb();
    const regionsColl = db.collection('seeded_regions');
    const playgroundsColl = db.collection('playgrounds');

    let keysToProcess = regionKeys;
    if (allRegions) {
        const docs = await regionsColl.find({}, { projection: { regionKey: 1 } }).toArray();
        keysToProcess = docs.map((d) => d.regionKey).filter(Boolean);
        if (keysToProcess.length === 0) {
            console.log('No regions in seeded_regions.');
            process.exit(0);
        }
    }

    console.log(`\n${apply ? 'APPLY' : 'DRY RUN'} — ${keysToProcess.length} region(s)\n`);
    console.log('Active = playgrounds with regionKey and no archivedAt (matches public API).\n');

    let updated = 0;
    for (const regionKey of keysToProcess) {
        const region = await regionsColl.findOne({ regionKey });
        if (!region) {
            console.log(`  [skip] ${regionKey} — not in seeded_regions`);
            continue;
        }

        const activeCount = await playgroundsColl.countDocuments({ regionKey, ...ACTIVE });
        const archivedCount = await playgroundsColl.countDocuments({
            regionKey,
            archivedAt: { $exists: true },
        });
        const previous = region.placeCount;

        console.log(`  ${regionKey}`);
        console.log(`    active (saved):   ${activeCount}`);
        console.log(`    archived:         ${archivedCount}`);
        console.log(`    seeded_regions.placeCount (before): ${previous ?? '(unset)'}`);

        if (previous === activeCount) {
            console.log(`    → already matches; no update needed\n`);
            continue;
        }

        if (apply) {
            await regionsColl.updateOne({ regionKey }, { $set: { placeCount: activeCount } });
            updated++;
            console.log(`    → set placeCount = ${activeCount}\n`);
        } else {
            console.log(`    → would set placeCount = ${activeCount} (re-run with --apply)\n`);
        }
    }

    if (apply) {
        console.log(`Done. Updated ${updated} region document(s).`);
    } else {
        console.log('Dry run complete. Re-run with --apply to write placeCount.');
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
