'use strict';

const { remapLegacyRegionKeysFromCoverage } = require('../services/regionKeyRemapFromCoverageService');

function emptySeededRegions() {
  return {
    find() {
      return { toArray: async () => [] };
    },
  };
}

describe('remapLegacyRegionKeysFromCoverage', () => {
  test('dry run returns mapping with live and archived counts', async () => {
    const mappingRow = { _id: 'legacy-ne', metro: 'omaha-ne', supportCount: 12 };
    const db = {
      collection(name) {
        if (name === 'seeded_regions') return emptySeededRegions();
        if (name === 'playgrounds') {
          return {
            aggregate() {
              return { toArray: async () => [mappingRow] };
            },
            countDocuments: async () => 7, // filterWeak + dry-run counts
          };
        }
        if (name === 'archived_playgrounds') {
          return {
            countDocuments: async () => 3,
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    };

    const result = await remapLegacyRegionKeysFromCoverage(db, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.mapping).toEqual([
      {
        from: 'legacy-ne',
        to: 'omaha-ne',
        supportCount: 12,
        liveMatched: 7,
        archivedMatched: 3,
      },
    ]);
    expect(result.playgroundsModified).toBeUndefined();
  });

  test('apply updates playgrounds and archives', async () => {
    const mappingRow = { _id: 'legacy-ne', metro: 'omaha-ne', supportCount: 2 };
    const db = {
      collection(name) {
        if (name === 'seeded_regions') return emptySeededRegions();
        if (name === 'playgrounds') {
          return {
            aggregate() {
              return { toArray: async () => [mappingRow] };
            },
            countDocuments: async () => 5,
            updateMany: async () => ({ matchedCount: 5, modifiedCount: 5 }),
          };
        }
        if (name === 'archived_playgrounds') {
          let calls = 0;
          return {
            updateMany: async () => {
              calls += 1;
              return calls === 1
                ? { matchedCount: 2, modifiedCount: 2 }
                : { matchedCount: 2, modifiedCount: 2 };
            },
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    };

    const result = await remapLegacyRegionKeysFromCoverage(db, { dryRun: false });
    expect(result.playgroundsModified).toBe(5);
    expect(result.archivesModified).toBe(2);
    expect(result.mapping[0].from).toBe('legacy-ne');
  });

  test('does not remap a seeded metro key listed oddly in coveredRegionKeys', async () => {
    const badRow = { _id: 'omaha-ne', metro: 'blair-ne', supportCount: 1 };
    const db = {
      collection(name) {
        if (name === 'seeded_regions') {
          return {
            find() {
              return { toArray: async () => [{ regionKey: 'omaha-ne' }, { regionKey: 'blair-ne' }] };
            },
          };
        }
        if (name === 'playgrounds') {
          return {
            aggregate() {
              return { toArray: async () => [badRow] };
            },
            countDocuments: async () => {
              throw new Error('countDocuments should not run when mapping empty');
            },
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    };

    const result = await remapLegacyRegionKeysFromCoverage(db, { dryRun: true });
    expect(result.mapping).toEqual([]);
  });

  test('drops omaha→blair when seeded_regions is empty but primary omaha count dwarfs evidence', async () => {
    const badRow = { _id: 'omaha-ne', metro: 'blair-ne', supportCount: 1 };
    const db = {
      collection(name) {
        if (name === 'seeded_regions') return emptySeededRegions();
        if (name === 'playgrounds') {
          return {
            aggregate() {
              return { toArray: async () => [badRow] };
            },
            countDocuments: async (q) => {
              if (q && q.regionKey === 'omaha-ne') return 535;
              return 0;
            },
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    };

    const result = await remapLegacyRegionKeysFromCoverage(db, { dryRun: true });
    expect(result.mapping).toEqual([]);
  });
});
