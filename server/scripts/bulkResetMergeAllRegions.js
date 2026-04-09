/**
 * Global merge reset: ALL playgrounds + ALL archived_playgrounds (every region).
 *
 * Calls venueMergeService.bulkResetMergeStateForTesting with allRegions: true, which:
 *  - Clears subVenues + mergeInfo on every document in `playgrounds`
 *  - Re-inserts every `archived_playgrounds` row into `playgrounds` (drops archiveInfo) when _id not already live
 *
 * SAFETY (required by server code):
 *   - Environment: ALLOW_GLOBAL_MERGE_RESET=1  (or string "true") in server/.env or shell
 *   - CLI: --apply --confirm=RESET_MERGE_ALL_DATABASE
 *
 * Dry run (default): only prints counts; no writes.
 *
 * Usage (from server/):
 *   node scripts/bulkResetMergeAllRegions.js
 *   ALLOW_GLOBAL_MERGE_RESET=1 node scripts/bulkResetMergeAllRegions.js --apply --confirm=RESET_MERGE_ALL_DATABASE
 *
 * Windows PowerShell:
 *   $env:ALLOW_GLOBAL_MERGE_RESET="1"; node scripts/bulkResetMergeAllRegions.js --apply --confirm=RESET_MERGE_ALL_DATABASE
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');
const { connectToServer, getDb } = require('../src/database');
const venueMergeService = require('../src/services/venueMergeService');

function parseArgs(argv) {
  let apply = false;
  let confirm = '';
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--apply') apply = true;
    if (argv[i].startsWith('--confirm=')) confirm = argv[i].slice('--confirm='.length);
  }
  return { apply, confirm };
}

async function dryRunCounts() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI in server/.env');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(resolveMongoDbName());
  const [
    playgroundTotal,
    archiveTotal,
    withSubVenues,
    withMergeInfo,
  ] = await Promise.all([
    db.collection('playgrounds').countDocuments({}),
    db.collection('archived_playgrounds').countDocuments({}),
    db.collection('playgrounds').countDocuments({ subVenues: { $exists: true, $ne: [] } }),
    db.collection('playgrounds').countDocuments({ mergeInfo: { $exists: true } }),
  ]);
  await client.close();
  return { playgroundTotal, archiveTotal, withSubVenues, withMergeInfo };
}

async function main() {
  const { apply, confirm } = parseArgs(process.argv);

  if (!apply) {
    const counts = await dryRunCounts();
    console.log(JSON.stringify({ dryRun: true, counts }, null, 2));
    console.log('\nNo changes made. To run a GLOBAL reset:');
    console.log('  1) Set ALLOW_GLOBAL_MERGE_RESET=1 in server/.env (or your shell environment).');
    console.log('  2) From server/:');
    console.log('     node scripts/bulkResetMergeAllRegions.js --apply --confirm=RESET_MERGE_ALL_DATABASE');
    return;
  }

  const allow =
    process.env.ALLOW_GLOBAL_MERGE_RESET === '1' ||
    process.env.ALLOW_GLOBAL_MERGE_RESET === 'true';
  if (!allow) {
    throw new Error('Refusing to run: set ALLOW_GLOBAL_MERGE_RESET=1 (or "true") in environment first.');
  }
  if (confirm !== 'RESET_MERGE_ALL_DATABASE') {
    throw new Error('Refusing to run: pass --confirm=RESET_MERGE_ALL_DATABASE exactly.');
  }

  await connectToServer();
  // Ensure getDb() is wired (venueMergeService uses it)
  if (!getDb()) throw new Error('Database not connected');

  const result = await venueMergeService.bulkResetMergeStateForTesting(null, {
    allRegions: true,
    confirm: 'RESET_MERGE_ALL_DATABASE',
  });

  console.log(JSON.stringify({ applied: true, result }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
