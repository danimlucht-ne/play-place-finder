const { getDb } = require('../database');
const { LIGHT_REFRESH_SEARCHES } = require('./seedSearchProfiles');
const { completeLightRefresh, failLightRefresh } = require('./seedJobQueueService');
const {
  fetchGooglePlaces,
  fetchPlaceDetails,
  filterOutPlacesArchivedAfterMerge,
  normalizeAndDedupe,
  discoverCampusSubvenues,
  seededRegionCenterToLatLng,
  generateSearchGrid,
  SEED_ALGORITHM_VERSION,
} = require('./seedOrchestratorService');

function envInt(name, fallback, min, max) {
  const value = parseInt(process.env[name] || '', 10);
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function lightRefreshBudget(overrides = {}) {
  return {
    radiusMeters: overrides.radiusMeters ?? envInt('SEED_LIGHT_REFRESH_RADIUS_METERS', 16093, 1000, 50000),
    maxNearbyCalls: overrides.maxNearbyCalls ?? envInt('SEED_LIGHT_REFRESH_MAX_NEARBY_CALLS', 8, 1, 100),
    maxDetailsCalls: overrides.maxDetailsCalls ?? envInt('SEED_LIGHT_REFRESH_MAX_DETAILS_CALLS', 200, 0, 5000),
    maxAnchorPoints: overrides.maxAnchorPoints ?? envInt('SEED_LIGHT_REFRESH_MAX_ANCHOR_POINTS', 200, 1, 20000),
  };
}

function detailsStatusPatch(details, now = new Date()) {
  const status = details?.business_status || null;
  const set = {
    lastGoogleStatusCheckAt: now,
    googleBusinessStatus: status,
  };
  const unset = {};

  if (status === 'CLOSED_PERMANENTLY') {
    set.status = 'closed';
    set.closedAt = now;
    set.closureReason = 'google_closed_permanently';
  } else if (status === 'OPERATIONAL') {
    set.status = 'active';
    unset.closedAt = '';
    unset.closureReason = '';
  } else if (status === 'CLOSED_TEMPORARILY') {
    set.status = 'active';
  }

  if (details?.website) set.website = details.website;
  if (details?.formatted_phone_number) set.phoneNumber = details.formatted_phone_number;
  if (details?.formatted_address) set.address = details.formatted_address;
  if (details?.opening_hours?.weekday_text?.length) {
    set.hours = details.opening_hours.weekday_text.join(' | ');
  }

  return { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) };
}

async function updateExistingGoogleStatuses(db, regionKey, options = {}) {
  const now = options.now || new Date();
  const budget = lightRefreshBudget(options.budget);
  if (budget.maxDetailsCalls <= 0) {
    return { placeDetailsCalls: 0, placesUpdated: 0, placesMarkedClosed: 0, placesReactivated: 0 };
  }

  const staleBefore = new Date(now.getTime() - envInt('SEED_LIGHT_REFRESH_DAYS', 30, 1, 365) * 86400000);
  const places = await db.collection('playgrounds').find({
    regionKey,
    googlePlaceId: { $exists: true, $nin: [null, ''] },
    $or: [
      { lastGoogleStatusCheckAt: { $exists: false } },
      { lastGoogleStatusCheckAt: { $lt: staleBefore } },
    ],
  }).limit(budget.maxDetailsCalls).toArray();

  let placeDetailsCalls = 0;
  let placesUpdated = 0;
  let placesMarkedClosed = 0;
  let placesReactivated = 0;

  for (const place of places) {
    const details = await fetchPlaceDetails(place.googlePlaceId);
    placeDetailsCalls += 1;
    if (!details) continue;

    const patch = detailsStatusPatch(details, now);
    await db.collection('playgrounds').updateOne({ _id: place._id }, patch);
    placesUpdated += 1;
    if (details.business_status === 'CLOSED_PERMANENTLY' && place.status !== 'closed') {
      placesMarkedClosed += 1;
    }
    if (details.business_status === 'OPERATIONAL' && place.status === 'closed') {
      placesReactivated += 1;
    }
  }

  return { placeDetailsCalls, placesUpdated, placesMarkedClosed, placesReactivated };
}

async function discoverNewPlaces(db, region, options = {}) {
  const budget = lightRefreshBudget(options.budget);
  const center = seededRegionCenterToLatLng(region.center);
  if (!center) {
    const err = new Error(`Region ${region.regionKey} has no usable center coordinates`);
    err.code = 'BAD_CENTER';
    throw err;
  }

  // Search around all existing playgrounds in the region to catch suburbs merged into the city
  const existingPlaygrounds = await db.collection('playgrounds').find({
    regionKey: region.regionKey,
    location: { $exists: true },
  }).project({ location: 1 }).limit(budget.maxAnchorPoints).toArray();

  const allRaw = [];
  const searches = LIGHT_REFRESH_SEARCHES.slice(0, budget.maxNearbyCalls);
  let googleNearbyCalls = 0;

  // First, search around the region center (main city area)
  const centerRaw = await fetchGooglePlaces(center.lat, center.lng, budget.radiusMeters, searches);
  allRaw.push(...centerRaw);
  googleNearbyCalls += searches.length;

  // Then search around an adaptive grid over geocode / stored viewport (not a fixed 3×3 center bias)
  const maxBoundsPts = envInt('SEED_LIGHT_REFRESH_BOUNDS_MAX_POINTS', 10, 2, 20);
  const gridPoints = generateSearchGrid(center.lat, center.lng, {
    viewport: region.viewport,
    maxPoints: maxBoundsPts,
  });
  for (const point of gridPoints) {
    if (googleNearbyCalls >= budget.maxNearbyCalls) break;
    const raw = await fetchGooglePlaces(point.lat, point.lng, budget.radiusMeters, searches);
    allRaw.push(...raw);
    googleNearbyCalls += searches.length;
  }

  // Then search around each existing playground to catch areas not covered by the grid
  for (const pg of existingPlaygrounds) {
    if (googleNearbyCalls >= budget.maxNearbyCalls) break;
    const coords = pg.location?.coordinates;
    if (!coords || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    const raw = await fetchGooglePlaces(lat, lng, budget.radiusMeters, searches);
    allRaw.push(...raw);
    googleNearbyCalls += searches.length;
  }

  const candidates = normalizeAndDedupe(allRaw, region.regionKey);
  const toUpsert = await filterOutPlacesArchivedAfterMerge(db, candidates);
  if (toUpsert.length === 0) {
    return {
      googleNearbyCalls,
      candidatesScanned: candidates.length,
      candidatesInserted: 0,
      placesSkipped: candidates.length,
    };
  }

  const result = await db.collection('playgrounds').bulkWrite(
    toUpsert.map((p) => ({
      updateOne: {
        filter: { _id: p._id },
        update: { $setOnInsert: { ...p, status: p.status || 'active' } },
        upsert: true,
      },
    })),
  );
  const candidatesInserted = result.upsertedCount || 0;
  return {
    googleNearbyCalls,
    candidatesScanned: candidates.length,
    candidatesInserted,
    placesSkipped: Math.max(0, candidates.length - candidatesInserted),
  };
}

async function runLightRefresh(regionKey, options = {}) {
  const db = options.db || getDb();
  const now = options.now || new Date();
  const region = await db.collection('seeded_regions').findOne({ regionKey });
  if (!region) {
    const err = new Error(`Region not found: ${regionKey}`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  await db.collection('seeded_regions').updateOne(
    { regionKey },
    { $set: { refreshStatus: 'running', refreshInFlight: true, refreshStartedAt: now } },
  );

  try {
    const discovery = await discoverNewPlaces(db, region, options);
    const campusDiscovery = await discoverCampusSubvenues(regionKey, { db, ...(options.campusDiscovery || {}) });
    const status = await updateExistingGoogleStatuses(db, regionKey, options);
    let canonicalization = null;
    try {
      const { canonicalizeRegionVenues } = require('./venueMergeService');
      canonicalization = await canonicalizeRegionVenues(regionKey);
    } catch (mergeErr) {
      canonicalization = { errorMessage: mergeErr.message };
    }
    const progress = { ...discovery, campusDiscovery, ...status, canonicalization };

    await db.collection('seed_jobs').updateOne(
      { regionKey, type: 'light_refresh', status: { $in: ['queued', 'running'] } },
      {
        $set: {
          status: 'complete',
          phase: 'complete',
          progress,
          completedAt: now,
          updatedAt: now,
        },
      },
    );
    await completeLightRefresh(db, regionKey, {
      now,
      regionPatch: { seedAlgorithmVersion: SEED_ALGORITHM_VERSION },
    });
    return { regionKey, progress };
  } catch (err) {
    await db.collection('seed_jobs').updateOne(
      { regionKey, type: 'light_refresh', status: { $in: ['queued', 'running'] } },
      {
        $set: {
          status: 'failed',
          phase: 'failed',
          errorMessage: err.message,
          completedAt: now,
          updatedAt: now,
        },
      },
    ).catch(() => {});
    await failLightRefresh(db, regionKey, err, { now }).catch(() => {});
    throw err;
  }
}

async function runQueuedLightRefreshJobs(options = {}) {
  const db = options.db || getDb();
  const limit = options.limit ?? envInt('SEED_LIGHT_REFRESH_WORKER_LIMIT', 5, 1, 100);
  const workerId = options.workerId || `seed-light-refresh-${process.pid}`;
  const jobs = await db.collection('seed_jobs')
    .find({ type: 'light_refresh', status: 'queued' })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();

  const results = [];
  for (const job of jobs) {
    const claimed = await db.collection('seed_jobs').updateOne(
      { _id: job._id, status: 'queued' },
      {
        $set: {
          status: 'running',
          lockedAt: new Date(),
          lockedBy: workerId,
          phase: 'claimed',
          updatedAt: new Date(),
        },
        $inc: { attempts: 1 },
      },
    );
    if (claimed.modifiedCount === 0) {
      results.push({ regionKey: job.regionKey, status: 'skipped_claimed_elsewhere' });
      continue;
    }
    try {
      const result = await runLightRefresh(job.regionKey, { ...options, db });
      results.push({ regionKey: job.regionKey, status: 'complete', progress: result.progress });
    } catch (err) {
      results.push({ regionKey: job.regionKey, status: 'failed', errorMessage: err.message });
    }
  }
  return { processed: results.length, results };
}

module.exports = {
  lightRefreshBudget,
  detailsStatusPatch,
  discoverNewPlaces,
  updateExistingGoogleStatuses,
  runLightRefresh,
  runQueuedLightRefreshJobs,
};
