/**
 * Remap legacy regionKey -> umbrella metro (playgrounds + archived_playgrounds)
 * using live rows' coveredRegionKeys. Delegates to regionKeyRemapFromCoverageService.
 *
 * Usage (from server/):
 *   node scripts/remapArchivedRegionKeysFromCoverage.js --dry-run
 *   node scripts/remapArchivedRegionKeysFromCoverage.js --apply
 *   node scripts/remapArchivedRegionKeysFromCoverage.js --dry-run --only-metro=omaha-ne
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');
const { remapLegacyRegionKeysFromCoverage } = require('../src/services/regionKeyRemapFromCoverageService');

function parseArgs(argv) {
  const out = { dryRun: true, onlyMetro: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.dryRun = false;
    if (a === '--dry-run') out.dryRun = true;
    if (a.startsWith('--only-metro=')) out.onlyMetro = a.split('=')[1].trim();
  }
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI in server/.env');

  const { dryRun, onlyMetro } = parseArgs(process.argv);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(resolveMongoDbName());

  const result = await remapLegacyRegionKeysFromCoverage(db, { dryRun, onlyMetro });
  console.log(JSON.stringify(result, null, 2));

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
