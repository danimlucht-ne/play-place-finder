jest.mock('../database', () => ({ getDb: jest.fn() }));

const { getDb } = require('../database');
const {
  centerToLatLng,
  haversineDistanceMiles,
  resolveRegionKeys,
  getRadiusPreview,
  RADIUS_SURCHARGES,
} = require('../services/radiusTargetingService');

function mockCollection(dataByCollection) {
  return (name) => ({
    findOne: jest.fn(async (filter) => dataByCollection[name].find((doc) => doc.regionKey === filter.regionKey) || null),
    find: jest.fn(() => ({
      toArray: jest.fn(async () => dataByCollection[name]),
    })),
    aggregate: jest.fn(() => ({
      toArray: jest.fn(async () => dataByCollection.usersByRegion || []),
    })),
  });
}

describe('radiusTargetingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normalizes legacy lat/lng and GeoJSON centers', () => {
    expect(centerToLatLng({ lat: 41.25, lng: -96.0 })).toEqual({ lat: 41.25, lng: -96.0 });
    expect(centerToLatLng({ type: 'Point', coordinates: [-96.0, 41.25] })).toEqual({ lat: 41.25, lng: -96.0 });
    expect(centerToLatLng({ type: 'Point', coordinates: ['bad', 41.25] })).toBeNull();
    expect(centerToLatLng(null)).toBeNull();
  });

  test('haversine distance is zero for identical points and symmetric otherwise', () => {
    expect(haversineDistanceMiles(41.25, -96.0, 41.25, -96.0)).toBeCloseTo(0, 5);

    const omahaToLincoln = haversineDistanceMiles(41.2565, -95.9345, 40.8136, -96.7026);
    const lincolnToOmaha = haversineDistanceMiles(40.8136, -96.7026, 41.2565, -95.9345);
    expect(omahaToLincoln).toBeCloseTo(lincolnToOmaha, 5);
    expect(omahaToLincoln).toBeGreaterThan(40);
  });

  test('resolves regions in range and sorts by nearest first', async () => {
    getDb.mockReturnValue({
      collection: mockCollection({
        seeded_regions: [
          { regionKey: 'omaha-ne', city: 'Omaha', center: { lat: 41.2565, lng: -95.9345 } },
          { regionKey: 'nearby-ne', city: 'Nearby', center: { type: 'Point', coordinates: [-96.0, 41.3] } },
          { regionKey: 'far-ne', city: 'Far', center: { lat: 40.8136, lng: -96.7026 } },
        ],
      }),
    });

    const result = await resolveRegionKeys('omaha-ne', 20);

    expect(result.homeCenter).toEqual({ lat: 41.2565, lng: -95.9345 });
    expect(result.regionKeys).toEqual(['omaha-ne', 'nearby-ne']);
  });

  test('falls back to the closest region if nothing falls within the selected radius', async () => {
    getDb.mockReturnValue({
      collection: mockCollection({
        seeded_regions: [
          { regionKey: 'home', city: 'Home', center: { lat: 0, lng: 0 } },
          { regionKey: 'closest', city: 'Closest', center: { lat: 1, lng: 1 } },
        ],
      }),
    });

    const result = await resolveRegionKeys('home', 0.1, { lat: 5, lng: 5 });

    expect(result.regionKeys).toEqual(['closest']);
    expect(result.homeCenter).toEqual({ lat: 5, lng: 5 });
  });

  test('builds radius preview tiers with user counts and selectable radii', async () => {
    getDb.mockReturnValue({
      collection: mockCollection({
        seeded_regions: [
          { regionKey: 'home', city: 'Home', center: { lat: 0, lng: 0 } },
          { regionKey: 'nearby', city: 'Nearby', center: { lat: 0.1, lng: 0.1 } },
          { regionKey: 'outer', city: 'Outer', center: { lat: 0.35, lng: 0.35 } },
        ],
        usersByRegion: [
          { _id: 'home', count: 3 },
          { _id: 'nearby', count: 2 },
          { _id: 'outer', count: 5 },
        ],
      }),
    });

    const preview = await getRadiusPreview('home');

    expect(preview.homeCityName).toBe('Home');
    expect(preview.tiers).toHaveLength(4);
    expect(preview.tiers[0]).toMatchObject({
      radiusMiles: 20,
      surchargeInCents: RADIUS_SURCHARGES[20],
      userCount: 5,
      selectable: true,
    });
    expect(preview.selectableRadii).toEqual([20, 40, 50]);
  });
});
