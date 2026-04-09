const { enqueueLightRefreshIfNeeded } = require('../services/seedJobQueueService');

function collectionWith(methods) {
  return {
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'job-1' }),
    ...methods,
  };
}

function makeDb(collections) {
  return {
    collection: jest.fn((name) => collections[name]),
  };
}

describe('seedJobQueueService', () => {
  test('does not enqueue a fresh region', async () => {
    const db = makeDb({
      seeded_regions: collectionWith(),
      seed_jobs: collectionWith(),
    });

    const result = await enqueueLightRefreshIfNeeded(db, {
      regionKey: 'omaha-ne',
      nextLightRefreshAfter: new Date('2026-05-10T00:00:00Z'),
    }, { now: new Date('2026-04-10T00:00:00Z') });

    expect(result).toEqual({ enqueued: false, reason: 'fresh' });
    expect(db.collection('seed_jobs').insertOne).not.toHaveBeenCalled();
  });

  test('enqueues one stale region refresh and locks the region', async () => {
    const seeded = collectionWith();
    const jobs = collectionWith();
    const db = makeDb({ seeded_regions: seeded, seed_jobs: jobs });

    const result = await enqueueLightRefreshIfNeeded(db, {
      regionKey: 'omaha-ne',
      nextLightRefreshAfter: new Date('2026-04-01T00:00:00Z'),
    }, {
      now: new Date('2026-04-10T00:00:00Z'),
      requestedBy: 'user_search',
      requestedByUserId: 'user-1',
    });

    expect(result.enqueued).toBe(true);
    expect(seeded.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ regionKey: 'omaha-ne' }),
      expect.objectContaining({
        $set: expect.objectContaining({ refreshStatus: 'queued', refreshInFlight: true }),
      }),
    );
    expect(jobs.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      type: 'light_refresh',
      regionKey: 'omaha-ne',
      status: 'queued',
      requestedBy: 'user_search',
      requestedByUserId: 'user-1',
    }));
  });

  test('enqueues when admin marked region forceStale even if next refresh is in the future', async () => {
    const seeded = collectionWith();
    const jobs = collectionWith();
    const db = makeDb({ seeded_regions: seeded, seed_jobs: jobs });

    const result = await enqueueLightRefreshIfNeeded(db, {
      regionKey: 'omaha-ne',
      forceStale: true,
      nextLightRefreshAfter: new Date('2026-05-10T00:00:00Z'),
    }, { now: new Date('2026-04-10T00:00:00Z') });

    expect(result.enqueued).toBe(true);
    expect(jobs.insertOne).toHaveBeenCalled();
  });

  test('does not create a duplicate active refresh job when lock cannot be acquired', async () => {
    const seeded = collectionWith({
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    });
    const jobs = collectionWith();
    const db = makeDb({ seeded_regions: seeded, seed_jobs: jobs });

    const result = await enqueueLightRefreshIfNeeded(db, {
      regionKey: 'omaha-ne',
      nextLightRefreshAfter: new Date('2026-04-01T00:00:00Z'),
    }, { now: new Date('2026-04-10T00:00:00Z') });

    expect(result).toEqual({ enqueued: false, reason: 'already_queued_or_running' });
    expect(jobs.insertOne).not.toHaveBeenCalled();
  });
});
