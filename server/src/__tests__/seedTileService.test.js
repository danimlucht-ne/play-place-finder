const { tileKeyForLatLng, boundsForTileKey } = require('../services/seedTileService');

describe('seedTileService', () => {
  test('tileKeyForLatLng is stable for region + bucketed lat/lng', () => {
    const k1 = tileKeyForLatLng('omaha-ne', 41.224, -95.928);
    const k2 = tileKeyForLatLng('omaha-ne', 41.224, -95.928);
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^omaha-ne\|/);
  });

  test('boundsForTileKey returns sw/ne box', () => {
    const k = tileKeyForLatLng('x', 10, 20);
    const b = boundsForTileKey(k);
    expect(b.sw.lat).toBeLessThan(b.ne.lat);
    expect(b.sw.lng).toBeLessThan(b.ne.lng);
  });
});
