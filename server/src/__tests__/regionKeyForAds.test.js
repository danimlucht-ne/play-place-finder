const { canonicalRegionKeyForAds, regionKeyCandidates } = require('../utils/regionKeyForAds');

describe('regionKeyForAds', () => {
  test('canonicalRegionKeyForAds lowercases, swaps underscores, collapses spaces', () => {
    expect(canonicalRegionKeyForAds('Austin_TX')).toBe('austin-tx');
    expect(canonicalRegionKeyForAds('  Omaha NE ')).toBe('omaha-ne');
  });

  test('regionKeyCandidates includes raw, lower, canonical, and underscore variant', () => {
    const c = regionKeyCandidates('Omaha-NE');
    expect(c).toContain('Omaha-NE');
    expect(c).toContain('omaha-ne');
    expect(c).toContain('omaha_ne');
  });

  test('empty input yields empty canonical and candidates', () => {
    expect(canonicalRegionKeyForAds('')).toBe('');
    expect(canonicalRegionKeyForAds(null)).toBe('');
    expect(regionKeyCandidates('')).toEqual([]);
  });
});
