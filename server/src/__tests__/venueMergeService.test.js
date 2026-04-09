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

    test('matches Google zoo type', () => {
        expect(isCampusAnchorCandidate(place(1, 'Main Building', 41.2, -96.0, ['zoo', 'point_of_interest']))).toBe(true);
    });

    test('primary anchor requires name or playgroundType, not Google type alone', () => {
        expect(isPrimaryCampusAnchor(place(1, 'Main Building', 41.2, -96.0, ['zoo', 'point_of_interest']))).toBe(false);
        expect(isPrimaryCampusAnchor(place(1, 'Henry Doorly Zoo', 41.2, -96.0, ['zoo']))).toBe(true);
    });

    test('rejects generic park name without types', () => {
        expect(isCampusAnchorCandidate(place(1, 'Riverside Park', 41.2, -96.0))).toBe(false);
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
        const child = place(
            'c',
            'Henry Doorly Exhibit',
            41.22,
            -95.93,
            ['museum']
        );
        expect(shouldAttachAsCampusChild(anchor, child, 1600)).toBe(false);
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
        const child = place(
            'c',
            'Stingray Beach',
            41.2155,
            -95.928,
            ['establishment', 'point_of_interest']
        );
        expect(shouldAttachAsCampusChild(anchor, child, 1100)).toBe(false);
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
        const pool = place('pool', 'Elmwood Park Pool', 41.245, -95.9817, ['park'], {
            address: '808 S 60th St, Omaha, NE 68106',
        });
        const pavilion = place('pavilion', 'Pavilion', 41.2472, -95.9832, ['point_of_interest'], {
            playgroundType: 'Pavilion',
        });

        expect(shouldAttachAsParkChild(parent, pool, 120)).toBe(true);
        expect(shouldAttachAsParkChild(parent, pavilion, 410)).toBe(true);

        const clusters = buildParkAmenityClusters([parent, pool, pavilion]);
        expect(clusters.length).toBe(1);
        expect(clusters[0].map((p) => String(p._id)).sort()).toEqual(['p', 'pool', 'pavilion'].sort());
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
