/**
 * Explain campus / zoo parent clustering for a region vs live Mongo data.
 *
 * Usage (from server/):
 *   node scripts/diagnoseCampusParent.js --regionKey=omaha-ne
 *   node scripts/diagnoseCampusParent.js --regionKey=omaha-ne --placeId=ChIJIcEiazyPk4cRaXjAcBxV3BI
 *
 * Requires MONGODB_URI in .env (same as other scripts).
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');
const { ACTIVE_PLAYGROUND_FILTER } = require('../src/services/activePlaygroundFilter');
const vm = require('../src/services/venueMergeService');

function parseArgs(argv) {
  const out = { regionKey: 'omaha-ne', placeId: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--regionKey=')) out.regionKey = a.split('=')[1];
    else if (a.startsWith('--placeId=')) out.placeId = a.split('=')[1];
  }
  return out;
}

function trustworthyCoords(p) {
  if (!vm.hasValidLocation(p)) return false;
  const lng = p.location.coordinates[0];
  const lat = p.location.coordinates[1];
  if (Math.abs(lat) <= 1e-4 && Math.abs(lng) <= 1e-4) return false;
  return true;
}

function maxPairwiseMeters(places) {
  const pts = places.filter(trustworthyCoords);
  if (pts.length < 2) return 0;
  let maxD = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = vm.haversineMeters(
        pts[i].location.coordinates[1], pts[i].location.coordinates[0],
        pts[j].location.coordinates[1], pts[j].location.coordinates[0],
      );
      if (d > maxD) maxD = d;
    }
  }
  return maxD;
}

function makeDoorlyPredicate(canonicalPlaceId) {
  return (p) => {
    const id = String(p._id);
    if (canonicalPlaceId && id === canonicalPlaceId) return true;
    if (id === 'ChIJIcEiazyPk4cRaXjAcBxV3BI') return true;
    const n = `${p.name || ''}`.toLowerCase();
    return /\b(henry\s+doorly|doorly)\b/i.test(n);
  };
}

async function main() {
  const { regionKey, placeId } = parseArgs(process.argv);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI in server/.env');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(resolveMongoDbName());

  const strictFilter = { regionKey, ...ACTIVE_PLAYGROUND_FILTER };
  const listApiFilter = {
    ...ACTIVE_PLAYGROUND_FILTER,
    $or: [{ regionKey }, { coveredRegionKeys: regionKey }],
  };

  const [strictPlaces, expandedPlaces] = await Promise.all([
    db.collection('playgrounds').find(strictFilter).toArray(),
    db.collection('playgrounds').find(listApiFilter).toArray(),
  ]);

  const targetId = placeId || 'ChIJIcEiazyPk4cRaXjAcBxV3BI';
  const matchesTarget = (p) => String(p._id) === targetId;

  const inStrict = strictPlaces.filter(matchesTarget);
  const inExpandedOnly = expandedPlaces.filter(
    (p) => matchesTarget(p) && !strictPlaces.some((s) => String(s._id) === String(p._id)),
  );

  console.log('=== Campus parent diagnostic ===\n');
  console.log(`regionKey: ${regionKey}`);
  console.log(`canonical Google _id checked: ${targetId}\n`);

  console.log(`-- Active rows: strict merge set { regionKey } → ${strictPlaces.length}`);
  console.log(`-- Active rows: list API set { regionKey ∪ coveredRegionKeys } → ${expandedPlaces.length}`);
  if (inStrict.length) {
    const p = inStrict[0];
    console.log(`\n✓ Canonical place IS in strict merge set: "${p.name}" (types: ${(p.types || []).slice(0, 6).join(', ')})`);
    console.log(`  isPrimaryCampusAnchor: ${vm.isPrimaryCampusAnchor(p)}`);
  } else if (inExpandedOnly.length) {
    const p = inExpandedOnly[0];
    console.log(
      `\n⚠ Canonical place is NOT in strict merge set but IS returned by /by-region API:`,
      `"${p.name}" primary regionKey=${JSON.stringify(p.regionKey)} covered=${JSON.stringify(p.coveredRegionKeys || [])}`,
    );
    console.log(
      '  → detectAndGroupSubVenues / merge-preview campus pass only loads { regionKey }, so this parent',
      'never participates in Omaha campus clustering. Exhibits keyed to omaha-ne cannot attach to it.',
    );
  } else {
    console.log(`\n✗ No playground document with _id=${targetId} in either set (not seeded under this region).`);
  }

  const doorlyHaystack = makeDoorlyPredicate(targetId);
  const doorlyStrict = strictPlaces.filter(doorlyHaystack);
  const doorlyExpanded = expandedPlaces.filter(doorlyHaystack);
  console.log(`\n-- Name/id "Doorly" haystack: strict=${doorlyStrict.length}, expanded=${doorlyExpanded.length}`);
  if (doorlyExpanded.length && doorlyExpanded.length !== doorlyStrict.length) {
    const onlyExp = doorlyExpanded.filter((p) => !strictPlaces.some((s) => String(s._id) === String(p._id)));
    if (onlyExp.length) {
      console.log('  Rows visible in API but excluded from merge strict set:');
      for (const p of onlyExp.slice(0, 15)) {
        console.log(`    - ${String(p._id).slice(0, 24)}… ${p.name} regionKey=${p.regionKey}`);
      }
      if (onlyExp.length > 15) console.log(`    … and ${onlyExp.length - 15} more`);
    }
  }

  const zooSpanCap = parseInt(process.env.VENUE_CAMPUS_MAX_COMPONENT_DIAMETER_ZOO_M || '4200', 10);
  const defaultCap = parseInt(process.env.VENUE_CAMPUS_MAX_COMPONENT_DIAMETER_M || '1800', 10);

  const clusters = vm.buildCampusClusters(strictPlaces);
  console.log(`\n-- buildCampusClusters(strict merge set): ${clusters.length} cluster(s)`);
  if (clusters.length === 0) {
    console.log('  (no multi-member campus clusters for this set — each eligible place stands alone)');
  }

  const interesting = clusters.filter((c) => c.some(doorlyHaystack));
  const toPrint = interesting.length ? interesting : clusters.filter((c) => c.length >= 2).slice(0, 5);

  for (const c of toPrint.length ? toPrint : clusters) {
    const winner = vm.selectCampusClusterParent(c);
    const span = maxPairwiseMeters(c);
    const hasZooUmbrella = c.some((p) => {
      const types = (p.types || []).map((t) => String(t).toLowerCase());
      return vm.isPrimaryCampusAnchor(p) && (types.includes('zoo') || /\bzoo\b/i.test(p.name || ''));
    });
    const cap = hasZooUmbrella ? zooSpanCap : defaultCap;
    const dropped = span > cap;
    console.log(`\n  Cluster (${c.length} members) winner=${JSON.stringify(winner ? winner.name : '?')} id=${winner ? String(winner._id) : ''}`);
    console.log(`    pairwise span=${Math.round(span)}m cap=${cap}m (zoo umbrella=${hasZooUmbrella})${dropped ? ' → WOULD BE DROPPED in buildCampusClusters (span > cap)' : ''}`);
    for (const p of c.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      const mark = winner && String(p._id) === String(winner._id) ? ' *' : '';
      console.log(`    - ${String(p._id).slice(0, 20)}… ${p.name}${mark}`);
    }
  }

  if (!interesting.length && clusters.length) {
    console.log('\n(no cluster contained a Doorly / canonical-id row; printed a sample of other clusters)');
  }

  if (!inStrict.length && !inExpandedOnly.length && interesting.length) {
    console.log(
      '\n--- Interpretation ---\nThe canonical main-gate Google place_id is not in this database at all,',
      'but other Henry Doorly rows clustered. The merge pass picks the highest-scoring primary anchor',
      'among rows that exist — so you can get an exhibit-style listing as "parent" when the true gate POI is missing.',
    );
  }

  if (!inStrict.length && !inExpandedOnly.length) {
    const anywhere = await db.collection('playgrounds').findOne(
      { _id: targetId },
      { projection: { name: 1, regionKey: 1, coveredRegionKeys: 1, archivedAt: 1, status: 1 } },
    );
    const archived = await db.collection('archived_playgrounds').findOne(
      { _id: targetId },
      { projection: { name: 1, regionKey: 1, archiveInfo: 1 } },
    );
    if (anywhere) {
      console.log('\nNote: canonical id exists elsewhere in playgrounds:', JSON.stringify(anywhere));
    } else if (archived) {
      console.log('\nNote: canonical id exists in archived_playgrounds:', JSON.stringify(archived));
      const into = archived.archiveInfo && archived.archiveInfo.mergedIntoId;
      if (into) {
        console.log(
          '  → This row was absorbed as a SUB-venue of',
          String(into),
          '(winner at merge time). If that winner is an exhibit, the main gate listing was inverted.',
        );
      }
    }
  }

  await client.close();
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
