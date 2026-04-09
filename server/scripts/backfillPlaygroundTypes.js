/**
 * Backfill missing or stale `playgroundType` (thin wrapper around recategorizePlaygroundTypesService).
 *
 * For a full re-infer of all seeded rows after rule changes, prefer:
 *   node scripts/recategorizePlaygroundTypes.js --scope seeded --apply
 *
 * Usage:
 *   node scripts/backfillPlaygroundTypes.js             # dry-run (null/missing only)
 *   node scripts/backfillPlaygroundTypes.js --apply     # write null/missing only
 *   node scripts/backfillPlaygroundTypes.js --recheck   # dry-run missing + stale-on-seed
 *   node scripts/backfillPlaygroundTypes.js --recheck --apply
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');
const { recategorizePlaygroundTypes } = require('../src/services/recategorizePlaygroundTypesService');

const DRY_RUN = !process.argv.includes('--apply');
const RECHECK = process.argv.includes('--recheck');

async function run() {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('❌  MONGODB_URI not set in .env');
        process.exit(1);
    }

    const client = new MongoClient(mongoUri);
    await client.connect();
    const dbName = resolveMongoDbName();
    const db = client.db(dbName);

    const scope = RECHECK ? 'recheck_seed' : 'missing';
    const result = await recategorizePlaygroundTypes({
        db,
        dryRun: DRY_RUN,
        scope,
        sampleChanges: DRY_RUN ? 500 : 0,
    });

    const mode = RECHECK ? '(null/missing + stale on seed)' : '(null/missing only)';
    console.log(`\n${DRY_RUN ? '🔍 DRY RUN — ' : ''}scope=${scope} ${mode}`);
    console.log(`totalMatching: ${result.totalMatching}, examined: ${result.examined}, wouldChange: ${result.wouldChange}\n`);

    if (DRY_RUN && result.changes.length) {
        result.changes.forEach((c) => {
            const was = c.was != null && c.was !== '' ? ` (was: ${c.was})` : '';
            console.log(`  [${c.inferred}]${was}  ${c.name || c.id}`);
        });
        if (result.wouldChange > result.changes.length) {
            console.log(`  ... and ${result.wouldChange - result.changes.length} more`);
        }
    }

    console.log('\n--- Summary (new type counts) ---');
    Object.entries(result.countsByInferred)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => console.log(`  ${type.padEnd(20)} ${count}`));

    if (DRY_RUN) {
        console.log(`\n✅ Dry run complete.`);
        console.log(`   node scripts/backfillPlaygroundTypes.js${RECHECK ? ' --recheck' : ''} --apply`);
        if (!RECHECK) {
            console.log(`\n   Tip: scripts/recategorizePlaygroundTypes.js --scope seeded  (re-infer all seeded places)`);
        }
    } else {
        console.log(`\n✅ Updated ${result.written} document(s).`);
    }

    await client.close();
    process.exit(0);
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
