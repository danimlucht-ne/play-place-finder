/**
 * Explain why a Google Place ID might never appear after hybrid seed.
 *
 * Usage (from server/):
 *   node scripts/diagnoseSeedPlaceId.js ChIJ...
 *
 * Requires GOOGLE_MAPS_API_KEY in .env
 * Optional: MONGODB_URI in .env — also checks playgrounds / archived_playgrounds
 *
 * Keep FAST_SEED_SEARCHES in sync with seedOrchestratorService.handleHybridSearch (fast seed block).
 */

require('dotenv').config();
const axios = require('axios');
const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');
const { evaluateKidFriendlySeedCandidate } = require('../src/services/kidPlaceFilters');
const { DIAGNOSTIC_SEARCHES } = require('../src/services/seedSearchProfiles');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const FAST_RADIUS_M = 48280;

function nearbyUrl(lat, lng, radiusMeters, s) {
  const typeParam = s.type ? `&type=${encodeURIComponent(s.type)}` : '';
  const keywordParam = s.keyword ? `&keyword=${encodeURIComponent(s.keyword)}` : '';
  return `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}${typeParam}${keywordParam}&key=${GOOGLE_MAPS_API_KEY}`;
}

async function fetchPlaceDetails(placeId) {
  const fields = 'name,types,geometry,place_id,vicinity,formatted_address';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;
  const { data } = await axios.get(url);
  if (data.status !== 'OK' || !data.result) {
    throw new Error(`Place Details failed: ${data.status} ${data.error_message || ''}`);
  }
  return data.result;
}

function toNearbyShape(details) {
  const loc = details.geometry?.location;
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
    throw new Error('Place Details missing geometry.location');
  }
  return {
    place_id: details.place_id,
    name: details.name,
    types: details.types || [],
    vicinity: details.vicinity || '',
    geometry: { location: { lat: loc.lat, lng: loc.lng } },
  };
}

async function main() {
  const placeId = process.argv[2];
  if (!placeId) {
    console.error('Usage: node scripts/diagnoseSeedPlaceId.js <GOOGLE_PLACE_ID>');
    process.exit(1);
  }
  if (!GOOGLE_MAPS_API_KEY) {
    console.error('Missing GOOGLE_MAPS_API_KEY in environment');
    process.exit(1);
  }

  console.log('--- Place Details ---');
  const details = await fetchPlaceDetails(placeId);
  console.log('name:', details.name);
  console.log('vicinity:', details.vicinity || '(none)');
  console.log('types:', (details.types || []).join(', ') || '(none)');
  console.log('address:', details.formatted_address || '(none)');

  const tset = new Set((details.types || []).map((x) => String(x).toLowerCase()));
  const onlyAddressLike =
    tset.size > 0 &&
    [...tset].every((t) =>
      ['street_address', 'premise', 'subpremise', 'plus_code', 'geocode', 'route', 'political'].includes(t),
    );
  if (onlyAddressLike) {
    console.log(
      '\n*** WARNING: This Place ID is an address/geocode record, not a business POI. ***\n' +
        '    Seed uses Nearby Search + kid filters on establishment-like types.\n' +
        '    Use the Place ID for the venue itself (from the business pin / Place Details on the name).\n',
    );
  }

  const nearbyLike = toNearbyShape(details);
  const { lat, lng } = nearbyLike.geometry.location;

  console.log('\n--- Kid filter (same as normalizeAndDedupe) ---');
  const evalResult = evaluateKidFriendlySeedCandidate(nearbyLike);
  console.log(evalResult.ok ? 'PASS — would be kept after Google returns it' : 'FAIL — would be dropped in seed');
  if (!evalResult.ok) {
    evalResult.reasons.forEach((r) => console.log('  ·', r));
  }

  console.log(`\n--- Fast-seed Nearby Search (first page only, radius=${FAST_RADIUS_M}m, center=place lat/lng) ---`);
  console.log('If the place is missing from ALL rows below, Google did not return it on the first page(s) we probe.');
  console.log(
    'Production seeding follows next_page_token up to GOOGLE_PLACES_NEARBY_EXTRA_PAGES extra pages per query (see seedOrchestratorService).\n',
  );

  const hits = [];
  for (const s of DIAGNOSTIC_SEARCHES) {
    const label = [s.type || '*', s.keyword || ''].filter(Boolean).join(' + ');
    const url = nearbyUrl(lat, lng, FAST_RADIUS_M, s);
    const { data } = await axios.get(url);
    const results = data.results || [];
    const idx = results.findIndex((r) => r.place_id === placeId);
    const status = data.status;
    if (idx >= 0) {
      hits.push(label);
      console.log(`HIT  [${label}] rank=${idx + 1}/${results.length} status=${status}`);
    } else {
      const next = data.next_page_token ? ' (has next_page — not fetched by seed)' : '';
      console.log(`miss [${label}] results=${results.length} status=${status}${next}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (hits.length > 0) {
    console.log('\nMatched queries:', hits.join(' | '));
  } else {
    console.log(
      '\nNo fast-seed query returned this place on page 1. Typical causes: keyword bias (e.g. amusement_center+family), ' +
        'ranking past 20, or centroid/radius (seed uses user location, not necessarily this pin — re-run with lat/lng args if needed).',
    );
  }

  const uri = process.env.MONGODB_URI;
  if (uri) {
    console.log('\n--- MongoDB ---');
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(resolveMongoDbName());
    const inPlay = await db.collection('playgrounds').findOne({ _id: placeId });
    const inPlayG = await db.collection('playgrounds').findOne({ googlePlaceId: placeId });
    const inArch = await db.collection('archived_playgrounds').findOne({ _id: placeId });
    console.log('playgrounds by _id:', inPlay ? `yes (${inPlay.name})` : 'no');
    console.log('playgrounds by googlePlaceId:', inPlayG ? `yes` : 'no');
    console.log('archived_playgrounds:', inArch ? 'yes (merged — filterOutPlacesArchivedAfterMerge skips re-upsert)' : 'no');

    const seeded = await db.collection('seeded_regions').findOne({ regionKey: inPlay?.regionKey || inPlayG?.regionKey });
    if (inPlay || inPlayG) {
      const rk = (inPlay || inPlayG).regionKey;
      console.log('regionKey on doc:', rk || '(none)');
    }
    console.log(
      'Note: if region is already in seeded_regions, handleHybridSearch does NOT re-call Google — it only reads DB $near.',
    );
    await client.close();
  } else {
    console.log('\n(Set MONGODB_URI to check playgrounds / archived_playgrounds / seeded_regions.)');
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
