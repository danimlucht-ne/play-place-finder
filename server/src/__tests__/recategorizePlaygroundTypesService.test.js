const {
    buildRecategorizeFilter,
    recategorizePlaygroundTypes,
} = require('../services/recategorizePlaygroundTypesService');

describe('buildRecategorizeFilter', () => {
    test('seeded scope requires googlePlaceId', () => {
        const f = buildRecategorizeFilter({ scope: 'seeded' });
        expect(f).toEqual({ googlePlaceId: { $exists: true, $nin: [null, ''] } });
    });

    test('seeded + regionKey', () => {
        const f = buildRecategorizeFilter({ scope: 'seeded', regionKey: 'omaha-ne' });
        expect(f).toEqual({
            $and: [{ regionKey: 'omaha-ne' }, { googlePlaceId: { $exists: true, $nin: [null, ''] } }],
        });
    });

    test('missing scope', () => {
        const f = buildRecategorizeFilter({ scope: 'missing' });
        expect(f.$or).toBeDefined();
        expect(f.$or.length).toBe(3);
    });
});

describe('recategorizePlaygroundTypes', () => {
    test('dry-run updates nothing', async () => {
        const docs = [
            { _id: 1, name: 'Westside Swimming Pool', types: ['park'], playgroundType: 'Public Park' },
            {
                _id: 2,
                name: 'Riverside Park',
                types: ['park'],
                playgroundType: 'Public Park',
            },
        ];
        const coll = {
            countDocuments: jest.fn().mockResolvedValue(2),
            find: jest.fn().mockReturnValue({
                async *[Symbol.asyncIterator]() {
                    for (const d of docs) yield d;
                },
            }),
            updateOne: jest.fn(),
        };
        const db = {
            collection: (name) => {
                expect(name).toBe('playgrounds');
                return coll;
            },
        };

        const result = await recategorizePlaygroundTypes({
            db,
            dryRun: true,
            scope: 'all',
            sampleChanges: 10,
        });

        expect(result.wouldChange).toBe(1);
        expect(result.written).toBe(0);
        expect(coll.updateOne).not.toHaveBeenCalled();
        expect(result.changes[0].inferred).toBe('Pool / Water Park');
    });
});
