/**
 * Re-run inferPlaygroundType on existing DB rows (e.g. after improving inference rules post-deploy).
 *
 * Usage:
 *   node scripts/recategorizePlaygroundTypes.js [--apply] [--region REGION_KEY]
 *     [--scope seeded|missing|stale_on_seed|recheck_seed|all] [--limit N]
 *
 * Default: dry-run, scope=seeded (all Google-seeded places), no limit.
 *
 * Scopes:
 *   seeded         — rows with googlePlaceId (typical after-seed pass)
 *   missing        — playgroundType null / empty / missing only
 *   stale_on_seed  — seeded rows whose type is a known legacy label (Museum, Water Park, …)
 *   recheck_seed   — missing OR stale_on_seed (matches old backfill --recheck query shape)
 *   all            — every playground (includes user submissions; use carefully)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');
const { recategorizePlaygroundTypes } = require('../src/services/recategorizePlaygroundTypesService');

function argValue(flag) {
    const i = process.argv.indexOf(flag);
    if (i === -1 || i + 1 >= process.argv.length) return null;
    return process.argv[i + 1];
}

const APPLY = process.argv.includes('--apply');
const regionKey = argValue('--region');
const scopeArg = argValue('--scope');
const limitArg = argValue('--limit');

const ALLOWED = new Set(['seeded', 'missing', 'stale_on_seed', 'recheck_seed', 'all']);
const scope = scopeArg && ALLOWED.has(scopeArg) ? scopeArg : 'seeded';
const limit = limitArg != null ? parseInt(limitArg, 10) : undefined;
if (limitArg != null && (Number.isNaN(limit) || limit < 1)) {
    console.error('Invalid --limit');
    process.exit(1);
}

async function main() {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('MONGODB_URI not set');
        process.exit(1);
    }

    const client = new MongoClient(mongoUri);
    await client.connect();
    const dbName = resolveMongoDbName();
    const db = client.db(dbName);

    console.log(
        `\n${APPLY ? 'APPLY' : 'DRY RUN'}  scope=${scope}${regionKey ? ` region=${regionKey}` : ''}${limit ? ` limit=${limit}` : ''}\n`
    );

    const result = await recategorizePlaygroundTypes({
        db,
        dryRun: !APPLY,
        scope,
        regionKey: regionKey || undefined,
        limit,
        sampleChanges: APPLY ? 0 : 80,
    });

    console.log('totalMatching:', result.totalMatching);
    console.log('examined:', result.examined);
    console.log('wouldChange:', result.wouldChange);
    if (APPLY) console.log('written:', result.written);
    if (result.truncated) console.log('(stopped early due to --limit)');
    console.log('\ncountsByInferred (for rows that change):');
    Object.entries(result.countsByInferred)
        .sort((a, b) => b[1] - a[1])
        .forEach(([k, v]) => console.log(`  ${k.padEnd(24)} ${v}`));

    if (!APPLY && result.changes.length) {
        console.log('\nSample changes:');
        result.changes.forEach((c) => console.log(`  [${c.inferred}] was=${JSON.stringify(c.was)}  ${c.name || c.id}`));
    }

    if (!APPLY && result.wouldChange > 0) {
        console.log('\nRe-run with --apply to write.');
    }

    await client.close();
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
