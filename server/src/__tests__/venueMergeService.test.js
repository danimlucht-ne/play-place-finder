jest.mock('../database', () => ({ getDb: jest.fn() }));

const { getDb } = require('../database');
const {
    buildCampusClusters,
    buildParkAmenityClusters,
    buildAddressSubvenueGroups,
    crossRegionAddressDedup,
    shouldAttachAsCampusChild,
    shouldAttachAsParkChild,
    isCampusAnchorCandidate,
    isPrimaryCampusAnchor,
    isPrimaryParkAnchor,
    bulkResetMergeStateForTesting,
    mergeFields,
    inferAmenityBooleansFromPlace,
    scoreCampusClusterParent,
    pickHigherScoredCampusParent,
} = require('../services/venueMergeService');

function place(id, name, lat, lng, types = [], extra = {}) {
    return {
        _id: id,
        name,
        types,
        location: { type: 'Point', coordinates: [lng, lat] },
        ...extra,
    };
}

describe('isCampusAnchorCandidate', () => {
    test('matches zoo in name', () => {
        expect(isCampusAnchorCandidate(place(1, 'Henry Doorly Zoo', 41.2, -96.0))).toBe(true);
    });

    test('Google zoo type without zoo in name is not a campus anchor candidate', () => {
        expect(isCampusAnchorCandidate(place(1, 'Main Building', 41.2, -96.0, ['zoo', 'point_of_interest']))).toBe(false);
    });

    test('Google zoo type with zoo in name is a campus anchor candidate', () => {
        expect(isCampusAnchorCandidate(place(1, 'Henry Doorly Zoo Gate', 41.2, -96.0, ['zoo', 'point_of_interest']))).toBe(true);
    });

    test('inferred Zoo playgroundType does not make Lied-style exhibits primary anchors', () => {
        expect(
            isPrimaryCampusAnchor(
                place(1, 'Lied Jungle', 41.2, -96.0, ['tourist_attraction'], { playgroundType: 'Zoo / Aquarium' }),
            ),
        ).toBe(false);
    });

    test('zoo foundation with Google zoo type is not a campus anchor candidate', () => {
        expect(
            isCampusAnchorCandidate(
                place(1, 'Omaha Zoo Foundation', 41.2, -96.0, ['zoo', 'point_of_interest']),
            ),
        ).toBe(false);
    });

    test('primary anchor requires name or playgroundType, not Google type alone', () => {
        expect(isPrimaryCampusAnchor(place(1, 'Main Building', 41.2, -96.0, ['zoo', 'point_of_interest']))).toBe(false);
        expect(isPrimaryCampusAnchor(place(1, 'Henry Doorly Zoo', 41.2, -96.0, ['zoo']))).toBe(true);
    });

    test('rejects generic park name without types', () => {
        expect(isCampusAnchorCandidate(place(1, 'Riverside Park', 41.2, -96.0))).toBe(false);
    });
});

describe('scoreCampusClusterParent (umbrella dedupe)', () => {
    test('treats & like and for main-gate style zoo names (duplicate Google umbrella rows)', () => {
        const withAmp = place('a', "Henry Doorly Zoo & Aquarium", 41.224, -95.928, ['zoo', 'tourist_attraction']);
        const withAnd = place('b', 'Henry Doorly Zoo and Aquarium', 41.224, -95.928, ['zoo', 'tourist_attraction']);
        expect(scoreCampusClusterParent(withAmp)).toBeCloseTo(scoreCampusClusterParent(withAnd), 5);
    });

    test('pickHigherScoredCampusParent breaks score ties with lexicographically smaller _id', () => {
        const second = place('2', 'Test Zoo and Aquarium', 41, -96, ['zoo', 'tourist_attraction']);
        const first = place('1', 'Test Zoo and Aquarium', 41, -96, ['zoo', 'tourist_attraction']);
        const w = pickHigherScoredCampusParent([second, first]);
        expect(String(w._id)).toBe('1');
    });
});

describe('shouldAttachAsCampusChild', () => {
    const anchor = place(
        'a',
        'Omaha\'s Henry Doorly Zoo',
        41.214,
        -95.926,
        ['zoo', 'tourist_attraction']
    );

    test('true when child name shares significant token (doorly)', () => {
        const child = place(
            'c',
            'Desert Dome at Henry Doorly',
            41.215,
            -95.927,
            ['tourist_attraction']
        );
        expect(shouldAttachAsCampusChild(anchor, child, 120)).toBe(true);
    });

    test('false for restaurant type even if close', () => {
        const child = place(
            'c',
            'Snack Bar',
            41.2145,
            -95.9265,
            ['restaurant', 'food']
        );
        expect(shouldAttachAsCampusChild(anchor, child, 50)).toBe(false);
    });

    test('false beyond campus radius', () => {
        const museumAnchor = place(
            'm',
            'Metropolitan Museum of Art',
            40.7794,
            -73.9632,
            ['museum', 'point_of_interest'],
        );
        const child = place(
            'c',
            'Exhibit Wing',
            40.793,
            -73.9632,
            ['museum'],
        );
        expect(shouldAttachAsCampusChild(museumAnchor, child, 1600)).toBe(false);
    });

    test('true for on-grounds exhibit name with no shared tokens (primary anchor + visitor type)', () => {
        const child = place(
            'c',
            'Lied Jungle',
            41.2152,
            -95.9275,
            ['tourist_attraction']
        );
        expect(shouldAttachAsCampusChild(anchor, child, 160)).toBe(true);
    });

    test('true for establishment/point_of_interest POI within on-grounds radius of primary anchor', () => {
        const child = place(
            'c',
            'Stingray Beach',
            41.2155,
            -95.928,
            ['establishment', 'point_of_interest']
        );
        expect(shouldAttachAsCampusChild(anchor, child, 800)).toBe(true);
    });

    test('false for establishment/point_of_interest POI beyond on-grounds radius', () => {
        const museumAnchor = place(
            'm',
            'Metropolitan Museum of Art',
            40.7794,
            -73.9632,
            ['museum', 'point_of_interest'],
        );
        const child = place(
            'c',
            'Gift Shop Kiosk',
            40.7894,
            -73.9632,
            ['establishment', 'point_of_interest'],
        );
        expect(shouldAttachAsCampusChild(museumAnchor, child, 1100)).toBe(false);
    });

    test('two primary campus anchors do not merge at distance (botanical garden vs zoo)', () => {
        const garden = place(
            'g',
            'New York Botanical Garden',
            40.8625,
            -73.8775,
            ['tourist_attraction'],
            { playgroundType: 'Botanical Garden' }
        );
        const zoo = place(
            'z',
            'Bronx Zoo',
            40.8506,
            -73.8769,
            ['zoo', 'tourist_attraction']
        );
        expect(isPrimaryCampusAnchor(garden)).toBe(true);
        expect(isPrimaryCampusAnchor(zoo)).toBe(true);
        expect(shouldAttachAsCampusChild(zoo, garden, 900)).toBe(false);
    });

    test('zoo umbrella does not absorb Lauritzen-style gardens next door', () => {
        const zoo = place('z', "Omaha's Henry Doorly Zoo and Aquarium", 41.2242, -95.9284, ['zoo', 'tourist_attraction']);
        const gardens = place(
            'g',
            'Lauritzen Gardens',
            41.2295,
            -95.9195,
            ['tourist_attraction', 'park']
        );
        expect(shouldAttachAsCampusChild(zoo, gardens, 600)).toBe(false);
    });

    test('zoo umbrella does not absorb Kenefick-style rail museums nearby', () => {
        const zoo = place('z', "Omaha's Henry Doorly Zoo and Aquarium", 41.2242, -95.9284, ['zoo', 'tourist_attraction']);
        const railMuseum = place(
            'k',
            'Kenefick Locomotive Museum',
            41.228,
            -95.931,
            ['museum', 'tourist_attraction']
        );
        expect(shouldAttachAsCampusChild(zoo, railMuseum, 400)).toBe(false);
    });

    test('museum umbrella does not absorb a nearby public park POI', () => {
        const museum = place('m', 'Joslyn Art Museum', 41.256, -95.941, ['museum', 'tourist_attraction']);
        const park = place('p', 'Bayliss Park', 41.2565, -95.9415, ['park', 'tourist_attraction']);
        expect(shouldAttachAsCampusChild(museum, park, 400)).toBe(false);
    });

    test('museum umbrella does not absorb a public library one block away', () => {
        const museum = place('m', 'Joslyn Art Museum', 41.256, -95.941, ['museum', 'tourist_attraction']);
        const lib = place('l', 'Downtown Branch, Omaha Public Library', 41.2562, -95.9412, ['library', 'point_of_interest']);
        expect(shouldAttachAsCampusChild(museum, lib, 120)).toBe(false);
    });
});

describe('buildCampusClusters', () => {
    test('groups anchor with token-matching child', () => {
        const anchor = place(
            '1',
            'City Zoo',
            41.0,
            -96.0,
            ['zoo']
        );
        const child = place(
            '2',
            'City Zoo — Arctic Exhibit',
            41.0005,
            -96.0002,
            ['tourist_attraction']
        );
        const other = place(
            '3',
            'Unrelated Park',
            41.0006,
            -96.0003,
            ['park']
        );
        const clusters = buildCampusClusters([anchor, child, other]);
        expect(clusters.length).toBe(1);
        expect(clusters[0].map((p) => String(p._id)).sort()).toEqual(['1', '2'].sort());
    });

    test('zoo type on exhibit POI does not seed a second cluster', () => {
        const main = place('1', 'Henry Doorly Zoo', 41.214, -95.926, ['zoo']);
        const typedPoi = place('2', 'Wildlife Encounter', 41.2141, -95.9261, ['zoo', 'point_of_interest']);
        const exhibit = place('3', 'Desert Dome', 41.2145, -95.9265, ['tourist_attraction']);
        const clusters = buildCampusClusters([main, typedPoi, exhibit]);
        expect(clusters.length).toBe(1);
        expect(clusters[0].length).toBe(3);
    });

    test('groups Henry Doorly-style exhibits spread across a large campus under one parent', () => {
        const main = place('1', 'Omaha\'s Henry Doorly Zoo and Aquarium', 41.2242, -95.9284, ['zoo', 'tourist_attraction']);
        const exhibits = [
            place('2', 'Desert Dome', 41.2249, -95.9289, ['tourist_attraction']),
            place('3', 'Lied Jungle', 41.2227, -95.9300, ['tourist_attraction']),
            place('4', 'Suzanne and Walter Scott Aquarium', 41.2213, -95.9270, ['aquarium', 'tourist_attraction']),
            place('5', 'Hubbard Gorilla Valley', 41.2188, -95.9255, ['tourist_attraction']),
            place('6', 'Asian Highlands', 41.2168, -95.9238, ['tourist_attraction']),
        ];
        const restaurant = place('7', 'Zoo Cafe', 41.2243, -95.9285, ['restaurant', 'food']);
        const parking = place('8', 'Henry Doorly Zoo Parking Lot', 41.2243, -95.9285, ['parking']);

        const clusters = buildCampusClusters([main, ...exhibits, restaurant, parking]);

        expect(clusters.length).toBe(1);
        expect(clusters[0].map((p) => String(p._id)).sort()).toEqual(['1', '2', '3', '4', '5', '6'].sort());
    });

    test('zoo foundation rows are not campus cluster members even when Google types them as zoo', () => {
        const foundation = place('f', 'Omaha Zoo Foundation', 41.2242, -95.9284, ['zoo', 'point_of_interest']);
        const main = place('1', "Omaha's Henry Doorly Zoo and Aquarium", 41.2242, -95.9284, ['zoo', 'tourist_attraction']);
        const lied = place('2', 'Lied Jungle', 41.2227, -95.93, ['tourist_attraction']);
        const clusters = buildCampusClusters([foundation, main, lied]);
        expect(clusters.length).toBe(1);
        const names = clusters[0].map((p) => p.name);
        expect(names).not.toContain('Omaha Zoo Foundation');
    });

    test('zoo umbrella row is chosen as parent over a shorter exhibit name', () => {
        const main = place('1', "Omaha's Henry Doorly Zoo and Aquarium", 41.2242, -95.9284, ['zoo', 'tourist_attraction'], {
            imageUrls: ['x'],
        });
        const lied = place('2', 'Lied Jungle', 41.2227, -95.93, ['tourist_attraction'], {
            imageUrls: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        });
        const clusters = buildCampusClusters([main, lied]);
        expect(clusters.length).toBe(1);
        expect(String(clusters[0][0]._id)).toBe('1');
    });
});

describe('buildParkAmenityClusters', () => {
    test('identifies park parent and attaches splash pad, fields, trail, and playground', () => {
        const parent = place('p', 'Elmwood Park', 41.244, -95.982, ['park']);
        const splash = place('s', 'Elmwood Park Splash Pad', 41.2448, -95.9815, ['park']);
        const soccer = place('f', 'Elmwood Soccer Field 3', 41.246, -95.983, ['stadium']);
        const trail = place('t', 'Elmwood Walking Trail', 41.247, -95.984, ['point_of_interest']);
        const playground = place('g', 'Elmwood Park Playground', 41.245, -95.982, ['park']);
        const cafe = place('c', 'Elmwood Cafe', 41.2442, -95.9822, ['restaurant', 'food']);

        expect(isPrimaryParkAnchor(parent)).toBe(true);
        expect(isPrimaryParkAnchor(splash)).toBe(false);
        expect(shouldAttachAsParkChild(parent, splash, 100)).toBe(true);

        const clusters = buildParkAmenityClusters([parent, splash, soccer, trail, playground, cafe]);

        expect(clusters.length).toBe(1);
        expect(clusters[0].map((p) => String(p._id)).sort()).toEqual(['f', 'g', 'p', 's', 't'].sort());
    });

    test('attaches generic pavilion amenities even when they do not repeat the park name', () => {
        const parent = place('p', 'Elmwood Park', 41.244, -95.982, ['park'], {
            address: '808 S 60th St, Omaha, NE 68106',
        });
        const swim = place('swim', 'Elmwood Park Swimming Pool', 41.245, -95.9817, ['park'], {
            address: '808 S 60th St, Omaha, NE 68106',
        });
        const pavilion = place('pavilion', 'Pavilion', 41.2472, -95.9832, ['point_of_interest'], {
            playgroundType: 'Pavilion',
            address: '808 S 60th St, Omaha, NE 68106',
        });

        expect(shouldAttachAsParkChild(parent, swim, 120)).toBe(false);
        expect(shouldAttachAsParkChild(parent, pavilion, 410)).toBe(true);

        const clusters = buildParkAmenityClusters([parent, swim, pavilion]);
        expect(clusters.length).toBe(1);
        expect(clusters[0].map((p) => String(p._id)).sort()).toEqual(['p', 'pavilion'].sort());
    });

    test('does not merge different neighborhood parks on substring-only token overlap', () => {
        const sunridge = place('sunridge', 'Sunridge Park', 41.1857496, -96.1990782, ['park'], {
            address: '18043 Sunridge St, Omaha, NE 68136, USA',
        });
        const hickory = place('hickory', 'Hickory Ridge Park', 41.184687, -96.1908062, ['park'], {
            address: '17911 Margo St, Omaha, NE 68136, USA',
        });

        const distMeters = 702.24;
        expect(shouldAttachAsParkChild(sunridge, hickory, distMeters)).toBe(false);
        expect(shouldAttachAsParkChild(hickory, sunridge, distMeters)).toBe(false);
        expect(buildParkAmenityClusters([sunridge, hickory])).toEqual([]);
    });
});

describe('buildAddressSubvenueGroups', () => {
    test('groups two places with same normalized address', () => {
        const addr = '123 Main Street, Omaha, NE 68102, USA';
        const a = {
            _id: '1',
            name: 'West Wing',
            address: addr,
            location: { type: 'Point', coordinates: [-96.01, 41.26] },
        };
        const b = {
            _id: '2',
            name: 'East Wing',
            address: addr,
            location: { type: 'Point', coordinates: [-96.01, 41.26] },
        };
        const groups = buildAddressSubvenueGroups([a, b]);
        expect(groups.length).toBe(1);
        expect(groups[0].map((p) => String(p._id)).sort()).toEqual(['1', '2'].sort());
    });

    test('does not group unrelated parks that only share a bad geocoded address', () => {
        const addr = '1 Bad Geocode Way, Omaha, NE 68102, USA';
        const a = {
            _id: '1',
            name: 'Memorial Park',
            address: addr,
            location: { type: 'Point', coordinates: [-96.05, 41.30] },
        };
        const b = {
            _id: '2',
            name: 'Ruwe Park',
            address: addr,
            location: { type: 'Point', coordinates: [-96.20, 41.40] },
        };
        const groups = buildAddressSubvenueGroups([a, b]);
        expect(groups.length).toBe(0);
    });
});

describe('mergeFields amenity inference', () => {
    test('sets hasSplashPad from spray-style sub-venue names', () => {
        const parent = { _id: 'p', name: 'Hillsborough Park', hasSplashPad: false };
        const child = { _id: 'c', name: 'Hillsborough Park Sprayground' };
        const merged = mergeFields(parent, [child]);
        expect(merged.hasSplashPad).toBe(true);
    });

    test('sets isDogFriendly from dog park sub-venue names', () => {
        const parent = { _id: 'p', name: 'Clemons Park', isDogFriendly: false };
        const child = { _id: 'c', name: 'Dog Park' };
        const merged = mergeFields(parent, [child]);
        expect(merged.isDogFriendly).toBe(true);
    });

    test('inferAmenityBooleansFromPlace detects splash and dog signals', () => {
        expect(inferAmenityBooleansFromPlace({ name: 'Coyote Run Splashpad' }).hasSplashPad).toBe(true);
        expect(inferAmenityBooleansFromPlace({ name: 'Valley Dog Park' }).isDogFriendly).toBe(true);
    });

    test('inferAmenityBooleansFromPlace sets hasSkatePark from name, type, or Google skate_park', () => {
        expect(inferAmenityBooleansFromPlace({ name: 'Broadway Skate Park' }).hasSkatePark).toBe(true);
        expect(inferAmenityBooleansFromPlace({ name: 'X', playgroundType: 'Skate Park' }).hasSkatePark).toBe(true);
        expect(inferAmenityBooleansFromPlace({ name: 'Rink', types: ['skate_park', 'point_of_interest'] }).hasSkatePark).toBe(true);
        expect(inferAmenityBooleansFromPlace({ name: 'UNMC Ice Rink' }).hasSkatePark).toBeUndefined();
    });

    test('mergeFields sets hasSkatePark when a merged child is a skate park', () => {
        const parent = { _id: 'p', name: 'Peterson Park', hasSkatePark: false };
        const child = { _id: 'c', name: 'Broadway Skate Park', hasSkatePark: false };
        const merged = mergeFields(parent, [child]);
        expect(merged.hasSkatePark).toBe(true);
    });
});

describe('Henry Doorly campus parent scoring', () => {
    test('prefers main gate listing over Alaskan Adventure exhibit title', () => {
        const main = place('1', "Omaha's Henry Doorly Zoo and Aquarium", 41.2242, -95.9284, ['zoo', 'tourist_attraction']);
        const alaskan = place(
            '2',
            'Alaskan Adventure Henry Doorly Zoo',
            41.2245,
            -95.9286,
            ['tourist_attraction'],
        );
        const clusters = buildCampusClusters([main, alaskan]);
        expect(clusters.length).toBe(1);
        expect(String(clusters[0][0]._id)).toBe('1');
    });

    test('Alaskan Adventure Henry Doorly Zoo is not a primary campus anchor even when Google types it as zoo', () => {
        const branded = place('x', 'Alaskan Adventure Henry Doorly Zoo', 41.2245, -95.9286, ['zoo', 'tourist_attraction'], {
            imageUrls: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
            description: 'x'.repeat(80),
        });
        expect(isPrimaryCampusAnchor(branded)).toBe(false);
    });

    test('prefers main gate when Alaskan row outscores on photos but is Henry Doorly sub-brand', () => {
        const main = place('1', "Omaha's Henry Doorly Zoo and Aquarium", 41.2242, -95.9284, ['zoo', 'tourist_attraction'], {
            imageUrls: ['a'],
        });
        const alaskan = place('2', 'Alaskan Adventure Henry Doorly Zoo', 41.2245, -95.9286, ['zoo', 'tourist_attraction'], {
            imageUrls: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
            description: 'y'.repeat(100),
        });
        const lied = place('3', 'Lied Jungle', 41.2227, -95.93, ['tourist_attraction']);
        const clusters = buildCampusClusters([main, alaskan, lied]);
        expect(clusters.length).toBe(1);
        expect(String(clusters[0][0]._id)).toBe('1');
    });
});

describe('crossRegionAddressDedup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('merges same venue across regions and preserves covered region keys', async () => {
        const addr = '3701 S 10th St, Omaha, NE 68107';
        const omaha = place('omaha-place', 'Henry Doorly Zoo', 41.2242, -95.9284, ['zoo'], {
            address: addr,
            regionKey: 'omaha-ne',
            subVenues: [{ id: 'exhibit-1', name: 'Desert Dome' }],
        });
        const bellevue = place('bellevue-place', 'Omaha Henry Doorly Zoo', 41.22425, -95.92845, ['zoo'], {
            address: addr,
            regionKey: 'bellevue-ne',
            subVenues: [{ id: 'exhibit-2', name: 'Lied Jungle' }],
        });
        const updateOne = jest.fn().mockResolvedValue({});
        const insertMany = jest.fn().mockResolvedValue({});
        const deleteMany = jest.fn().mockResolvedValue({});
        getDb.mockReturnValue({
            collection: jest.fn((name) => {
                if (name === 'playgrounds') {
                    return {
                        find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([omaha, bellevue]) }),
                        updateOne,
                        deleteMany,
                    };
                }
                if (name === 'archived_playgrounds') return { insertMany };
                throw new Error(`Unexpected collection ${name}`);
            }),
        });

        const result = await crossRegionAddressDedup({ maxDistanceMeters: 150 });

        expect(result).toEqual({ merged: 1, archived: 1, clusterCount: 1 });
        expect(updateOne).toHaveBeenCalledWith(
            { _id: 'omaha-place' },
            {
                $set: expect.objectContaining({
                    coveredRegionKeys: ['omaha-ne', 'bellevue-ne'],
                    subVenues: [
                        { id: 'exhibit-1', name: 'Desert Dome' },
                        { id: 'exhibit-2', name: 'Lied Jungle' },
                    ],
                    mergeInfo: expect.objectContaining({ mergeType: 'cross_region_address' }),
                }),
            },
        );
        expect(deleteMany).toHaveBeenCalledWith({ _id: { $in: ['bellevue-place'] } });
    });
});

describe('bulkResetMergeStateForTesting', () => {
    test('rejects bad confirm', async () => {
        await expect(bulkResetMergeStateForTesting('omaha-ne', { confirm: 'no' })).rejects.toThrow(
            'RESET_MERGE_TEST',
        );
    });

    test('allRegions requires env flag', async () => {
        const prev = process.env.ALLOW_GLOBAL_MERGE_RESET;
        delete process.env.ALLOW_GLOBAL_MERGE_RESET;
        await expect(
            bulkResetMergeStateForTesting(undefined, {
                confirm: 'RESET_MERGE_ALL_DATABASE',
                allRegions: true,
            }),
        ).rejects.toThrow('ALLOW_GLOBAL_MERGE_RESET');
        if (prev !== undefined) process.env.ALLOW_GLOBAL_MERGE_RESET = prev;
    });

    test('clears merge fields for region and restores archived rows', async () => {
        const updateMany = jest.fn().mockResolvedValue({ matchedCount: 3, modifiedCount: 2 });
        const findOne = jest.fn();
        const insertOne = jest.fn().mockResolvedValue({});
        const deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });

        const childArch = {
            _id: 'child-1',
            name: 'Desert Dome',
            regionKey: 'omaha-ne',
            archiveInfo: { reason: 'subvenue_absorbed', mergedIntoId: 'parent-1' },
        };
        const staleArch = {
            _id: 'child-2',
            name: 'Already Live',
            regionKey: 'omaha-ne',
            archiveInfo: { reason: 'subvenue_absorbed' },
        };

        findOne
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ _id: 'child-2' });

        const archivedFind = jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([childArch, staleArch]),
        });

        getDb.mockReturnValue({
            collection: jest.fn((name) => {
                if (name === 'playgrounds') {
                    return { updateMany, findOne, insertOne };
                }
                if (name === 'archived_playgrounds') {
                    return { find: archivedFind, deleteOne };
                }
                throw new Error(`Unexpected collection ${name}`);
            }),
        });

        const result = await bulkResetMergeStateForTesting('omaha-ne', { confirm: 'RESET_MERGE_TEST' });

        expect(updateMany).toHaveBeenCalledWith(
            { regionKey: 'omaha-ne' },
            { $set: { subVenues: [] }, $unset: { mergeInfo: '' } },
        );
        expect(insertOne).toHaveBeenCalledTimes(1);
        expect(insertOne).toHaveBeenCalledWith(
            expect.objectContaining({ _id: 'child-1', name: 'Desert Dome', regionKey: 'omaha-ne' }),
        );
        expect(deleteOne).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            scope: 'region:omaha-ne',
            clearedMatched: 3,
            clearedModified: 2,
            archivedSeen: 2,
            restored: 1,
            archiveRemovedStale: 1,
            restoreErrors: [],
        });
    });
});
