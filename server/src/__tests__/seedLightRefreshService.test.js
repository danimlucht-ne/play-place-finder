jest.mock('../services/seedOrchestratorService', () => ({
  fetchGooglePlaces: jest.fn(),
  fetchPlaceDetails: jest.fn(),
  filterOutPlacesArchivedAfterMerge: jest.fn(async (_db, places) => places),
  normalizeAndDedupe: jest.fn(),
  discoverCampusSubvenues: jest.fn().mockResolvedValue({
    anchorsScanned: 1,
    googleNearbyCalls: 2,
    candidatesScanned: 2,
    candidatesInserted: 1,
    placesSkipped: 1,
  }),
  seededRegionCenterToLatLng: jest.fn((center) => center),
  generateSearchGrid: jest.fn((lat, lng) => [{ lat, lng }]),
  SEED_ALGORITHM_VERSION: 3,
}));
jest.mock('../services/venueMergeService', () => ({
  canonicalizeRegionVenues: jest.fn().mockResolvedValue({
    grouping: { campusGrouped: 0, parkGrouped: 1, grouped: 0 },
    dedup: { merged: 0, archived: 0 },
    crossRegion: { merged: 0, archived: 0, clusterCount: 0 },
  }),
}));

const {
  fetchGooglePlaces,
  fetchPlaceDetails,
  discoverCampusSubvenues,
  normalizeAndDedupe,
} = require('../services/seedOrchestratorService');
const { canonicalizeRegionVenues } = require('../services/venueMergeService');
const {
  detailsStatusPatch,
  discoverNewPlaces,
  runQueuedLightRefreshJobs,
  updateExistingGoogleStatuses,
} = require('../services/seedLightRefreshService');

function cursor(rows) {
  return {
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(rows),
  };
}

function makeDb(collections) {
  return {
    collection: jest.fn((name) => collections[name]),
  };
}

describe('seedLightRefreshService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('detailsStatusPatch soft-closes only explicit permanent closures', () => {
    const now = new Date('2026-04-10T00:00:00Z');
    expect(detailsStatusPatch({ business_status: 'CLOSED_PERMANENTLY' }, now)).toEqual({
      $set: {
        lastGoogleStatusCheckAt: now,
        googleBusinessStatus: 'CLOSED_PERMANENTLY',
        status: 'closed',
        closedAt: now,
        closureReason: 'google_closed_permanently',
      },
    });

    expect(detailsStatusPatch({ business_status: 'OPERATIONAL' }, now)).toEqual({
      $set: {
        lastGoogleStatusCheckAt: now,
        googleBusinessStatus: 'OPERATIONAL',
        status: 'active',
      },
      $unset: { closedAt: '', closureReason: '' },
    });
  });

  test('discoverNewPlaces uses the light profile budget and upserts new active places', async () => {
    fetchGooglePlaces.mockResolvedValue([{ place_id: 'g1' }]);
    normalizeAndDedupe.mockReturnValue([{ _id: 'g1', googlePlaceId: 'g1', name: 'New Park' }]);
    const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    const db = makeDb({
      playgrounds: {
        bulkWrite,
        find: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          toArray: jest.fn().mockResolvedValue([]),
        }),
      },
    });

    const result = await discoverNewPlaces(db, {
      regionKey: 'omaha-ne',
      center: { lat: 41.25, lng: -96.01 },
    }, { budget: { maxNearbyCalls: 8, radiusMeters: 10000 } });

    // Called for center + grid point (mock returns 1 grid point)
    expect(fetchGooglePlaces).toHaveBeenCalledWith(
      41.25,
      -96.01,
      10000,
      expect.arrayContaining([
        expect.objectContaining({ keyword: 'playground' }),
        expect.objectContaining({ keyword: 'splash pad' }),
      ]),
    );
    expect(bulkWrite.mock.calls[0][0][0].updateOne.update.$setOnInsert.status).toBe('active');
    expect(result.candidatesInserted).toBe(1);
  });

  test('updateExistingGoogleStatuses marks closed and reactivates operational places', async () => {
    fetchPlaceDetails
      .mockResolvedValueOnce({ business_status: 'CLOSED_PERMANENTLY' })
      .mockResolvedValueOnce({ business_status: 'OPERATIONAL', website: 'https://park.example' });
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = makeDb({
      playgrounds: {
        find: jest.fn().mockReturnValue(cursor([
          { _id: 'g1', googlePlaceId: 'g1', status: 'active' },
          { _id: 'g2', googlePlaceId: 'g2', status: 'closed' },
        ])),
        updateOne,
      },
    });

    const result = await updateExistingGoogleStatuses(db, 'omaha-ne', {
      now: new Date('2026-04-10T00:00:00Z'),
      budget: { maxDetailsCalls: 10 },
    });

    expect(updateOne).toHaveBeenCalledWith({ _id: 'g1' }, expect.objectContaining({
      $set: expect.objectContaining({ status: 'closed', googleBusinessStatus: 'CLOSED_PERMANENTLY' }),
    }));
    expect(updateOne).toHaveBeenCalledWith({ _id: 'g2' }, expect.objectContaining({
      $set: expect.objectContaining({ status: 'active', website: 'https://park.example' }),
      $unset: { closedAt: '', closureReason: '' },
    }));
    expect(result.placesMarkedClosed).toBe(1);
    expect(result.placesReactivated).toBe(1);
  });

  test('runQueuedLightRefreshJobs claims queued jobs before processing', async () => {
    fetchGooglePlaces.mockResolvedValue([]);
    normalizeAndDedupe.mockReturnValue([]);
    const seedJobs = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([{ _id: 'job-1', regionKey: 'omaha-ne' }]),
      }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const db = makeDb({
      seed_jobs: seedJobs,
      seeded_regions: {
        findOne: jest.fn().mockResolvedValue({ regionKey: 'omaha-ne', center: { lat: 41.25, lng: -96.01 } }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
      playgrounds: {
        bulkWrite: jest.fn(),
        find: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          toArray: jest.fn().mockResolvedValue([]),
        }),
      },
    });

    const result = await runQueuedLightRefreshJobs({ db, limit: 1, workerId: 'worker-1' });

    expect(seedJobs.updateOne).toHaveBeenCalledWith(
      { _id: 'job-1', status: 'queued' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'running', lockedBy: 'worker-1' }),
        $inc: { attempts: 1 },
      }),
    );
    expect(result.results[0].status).toBe('complete');
    expect(discoverCampusSubvenues).toHaveBeenCalledWith('omaha-ne', expect.objectContaining({ db }));
    expect(canonicalizeRegionVenues).toHaveBeenCalledWith('omaha-ne');
    expect(result.results[0].progress.campusDiscovery.candidatesInserted).toBe(1);
    expect(result.results[0].progress.canonicalization.grouping.parkGrouped).toBe(1);
  });
});
