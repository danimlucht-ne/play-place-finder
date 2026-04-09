/**
 * Standalone venue merge script — runs dedup + sub-venue grouping on existing data
 * without re-seeding.
 *
 * Usage (run from the server/ directory):
 *   node scripts/runMerge.js                          # all regions, dry-run (dedup preview only; no DB writes)
 *   node scripts/runMerge.js --apply                  # all regions: dedup + sub-venue grouping
 *   node scripts/runMerge.js omaha-ne lincoln-ne      # specific regions, dry-run
 *   node scripts/runMerge.js omaha-ne --apply         # specific region, execute
 *   node scripts/runMerge.js --distance 50            # custom proximity threshold (meters)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DRY_RUN = !process.argv.includes('--apply');
const distanceIdx = process.argv.indexOf('--distance');
const DISTANCE = distanceIdx !== -1 ? parseInt(process.argv[distanceIdx + 1], 10) : 100;
const regionArgs = process.argv.slice(2).filter(a =>
    !a.startsWith('--') && (distanceIdx === -1 || process.argv.indexOf(a) !== distanceIdx + 1)
);

async function main() {
    // Use the app's own database module so connection config is consistent
    const { connectToServer, getDb } = require('../src/database');
    await connectToServer();
    const db = getDb();

    const { proximityDedup, detectAndGroupSubVenues } = require('../src/services/venueMergeService');

    // Determine which regions to process
    let regions;
    if (regionArgs.length > 0) {
        regions = regionArgs;
    } else {
        const allRegions = await db.collection('seeded_regions').find({}).toArray();
        regions = allRegions.map(r => r.regionKey);
    }

    if (regions.length === 0) {
        console.log('No seeded regions found.');
        process.exit(0);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  Venue Merge — ${regions.length} region(s)${DRY_RUN ? '  [DRY RUN]' : '  [APPLY]'}`);
    console.log(`  Distance threshold: ${DISTANCE}m`);
    console.log(`${'='.repeat(60)}\n`);

    let grandTotalMerged = 0;
    let grandTotalArchived = 0;
    let grandTotalGrouped = 0;

    for (const regionKey of regions) {
        console.log(`\n${'-'.repeat(50)}`);
        console.log(`  Region: ${regionKey}`);
        console.log(`${'-'.repeat(50)}`);

        const placeCount = await db.collection('playgrounds').countDocuments({ regionKey });
        console.log(`  Active places: ${placeCount}`);

        if (placeCount === 0) {
            console.log('  Skipping — no places.');
            continue;
        }

        // 1. Proximity dedup
        try {
            const dedupResult = await proximityDedup(regionKey, { distanceMeters: DISTANCE, dryRun: DRY_RUN });
            if (DRY_RUN && Array.isArray(dedupResult.clusters)) {
                console.log(`  [dedup] Would merge ${dedupResult.clusters.length} cluster(s):`);
                dedupResult.clusters.forEach((c, i) => {
                    console.log(`    ${i + 1}. Winner: "${c.winner}" — merging ${c.count} places: ${c.members.join(', ')}`);
                });
            } else {
                console.log(`  [dedup] Merged: ${dedupResult.merged} clusters, Archived: ${dedupResult.archived} losers`);
                grandTotalMerged += dedupResult.merged;
                grandTotalArchived += dedupResult.archived;
            }
        } catch (err) {
            console.error(`  [dedup] FAILED: ${err.message}`);
        }

        // 2. Sub-venue grouping (only with --apply; dedup dry-run stays read-only for both)
        if (DRY_RUN) {
            console.log('  [group] Skipped (dry run — re-run with --apply to run sub-venue grouping)');
        } else {
            try {
                const groupResult = await detectAndGroupSubVenues(regionKey);
                const campusG = groupResult.campusGrouped || 0;
                const addrG = groupResult.grouped || 0;
                console.log(`  [group] Sub-venues: ${campusG + addrG} parent(s) (${campusG} campus, ${addrG} address)`);
                grandTotalGrouped += campusG + addrG;
            } catch (err) {
                console.error(`  [group] FAILED: ${err.message}`);
            }
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    if (DRY_RUN) {
        console.log('  DRY RUN complete — no changes were made.');
        console.log('  Re-run with --apply to execute merges.');
    } else {
        console.log(`  DONE — Merged: ${grandTotalMerged}, Archived: ${grandTotalArchived}, Grouped: ${grandTotalGrouped}`);
    }
    console.log(`${'='.repeat(60)}\n`);

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
