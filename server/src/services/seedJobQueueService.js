const { ObjectId } = require('mongodb');
const { isRegionDueForLightRefresh, nextLightRefreshAfter, staleLockMs } = require('./seedRefreshPolicy');

function newRunId(prefix = 'refresh') {
  return `${prefix}_${new ObjectId().toString()}`;
}

async function enqueueLightRefreshIfNeeded(db, region, options = {}) {
  if (!region?.regionKey) return { enqueued: false, reason: 'missing_region' };
  const now = options.now || new Date();
  const force = options.force === true;
  if (!force && !isRegionDueForLightRefresh(region, now)) {
    return { enqueued: false, reason: 'fresh' };
  }

  const staleBefore = new Date(now.getTime() - staleLockMs());
  const refreshRunId = newRunId('light_refresh');
  const regionFilter = {
    regionKey: region.regionKey,
    $or: [
      { refreshInFlight: { $ne: true } },
      { refreshStartedAt: { $lt: staleBefore } },
      { refreshStartedAt: { $exists: false } },
    ],
  };

  const locked = await db.collection('seeded_regions').updateOne(
    regionFilter,
    {
      $set: {
        refreshStatus: 'queued',
        refreshInFlight: true,
        refreshStartedAt: now,
        refreshRunId,
      },
    },
  );
  if (locked.modifiedCount === 0) {
    return { enqueued: false, reason: 'already_queued_or_running' };
  }

  await db.collection('seed_jobs').insertOne({
    type: 'light_refresh',
    regionKey: region.regionKey,
    status: 'queued',
    requestedByUserId: options.requestedByUserId || null,
    requestedBy: options.requestedBy || 'system',
    refreshRunId,
    attempts: 0,
    maxAttempts: options.maxAttempts || 2,
    phase: 'queued',
    progress: {
      googleNearbyCalls: 0,
      placeDetailsCalls: 0,
      candidatesScanned: 0,
      candidatesInserted: 0,
      placesUpdated: 0,
      placesMarkedClosed: 0,
      placesReactivated: 0,
      placesSkipped: 0,
      reviewItemsQueued: 0,
    },
    budget: options.budget || null,
    createdAt: now,
    updatedAt: now,
  });

  return { enqueued: true, refreshRunId };
}

async function completeLightRefresh(db, regionKey, patch = {}) {
  const now = patch.now || new Date();
  await db.collection('seeded_regions').updateOne(
    { regionKey },
    {
      $set: {
        refreshStatus: 'complete',
        refreshInFlight: false,
        lastLightRefreshAt: now,
        nextLightRefreshAfter: nextLightRefreshAfter(now),
        refreshCompletedAt: now,
        refreshErrorMessage: null,
        ...(patch.regionPatch || {}),
      },
    },
  );
}

async function failLightRefresh(db, regionKey, error, patch = {}) {
  const now = patch.now || new Date();
  await db.collection('seeded_regions').updateOne(
    { regionKey },
    {
      $set: {
        refreshStatus: 'failed',
        refreshInFlight: false,
        refreshCompletedAt: now,
        refreshErrorMessage: error?.message || String(error),
        ...(patch.regionPatch || {}),
      },
    },
  );
}

module.exports = {
  enqueueLightRefreshIfNeeded,
  completeLightRefresh,
  failLightRefresh,
  newRunId,
};
