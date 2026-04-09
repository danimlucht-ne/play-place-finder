const { getKidPlaceFilterConfig, isKidFriendlySeedCandidate } = require('../services/kidPlaceFilters');

describe('kidPlaceFilters', () => {
  test('exposes the expected allow and block signals', () => {
    const cfg = getKidPlaceFilterConfig();

    expect(cfg.bannedTypes.has('bar')).toBe(true);
    expect(cfg.bannedTypes.has('secondary_school')).toBe(true);
    expect(cfg.kidSignalTypes.has('park')).toBe(true);
    expect(cfg.kidSignalKeywords).toContain('splash pad');
    expect(cfg.kidSignalKeywords).toContain('fun park');
    expect(cfg.kidSignalKeywords).toContain('zoo exhibit');
    expect(cfg.kidSignalKeywords).toContain('habitat');
  });

  test.each([
    [{ name: 'Sunny Splash Pad', types: ['tourist_attraction'], vicinity: 'Main Park' }],
    [{ name: 'Putt-Putt Family Fun', types: ['point_of_interest'], vicinity: 'Arcade plaza' }],
    [{ name: 'Westside Elementary School', types: ['school'], vicinity: 'Omaha' }],
    [{ name: 'Downtown Public Library', types: ['local_library'], vicinity: 'Kids story time' }],
    // Google often tags FECs as establishment + POI only (no amusement_center).
    [{ name: 'Papio Fun Park', types: ['establishment', 'point_of_interest'], vicinity: '210 E Lincoln St' }],
    // Internal zoo POIs are often plain POIs with exhibit-style names.
    [{ name: 'Lied Jungle', types: ['establishment', 'point_of_interest'], vicinity: 'Omaha Zoo' }],
  ])('allows kid-friendly candidates %#', (place) => {
    expect(isKidFriendlySeedCandidate(place)).toBe(true);
  });

  test.each([
    [{ name: 'Tiny Tavern Playground', types: ['bar'], vicinity: 'Downtown' }],
    [{ name: 'County Courthouse', types: ['local_government_office'], vicinity: 'Civic Center' }],
    [{ name: 'Saint Mary Catholic School', types: ['school'], vicinity: 'Omaha' }],
    [{ name: 'Regional Law Library', types: ['library'], vicinity: 'University campus' }],
    // Pediatric/medical: Google often returns only establishment + POI; "children" in name is not a play signal.
    [{ name: "Children's Physicians – Mission Village", types: ['establishment', 'point_of_interest'], vicinity: 'Omaha' }],
  ])('blocks non-kid or risky false positives %#', (place) => {
    expect(isKidFriendlySeedCandidate(place)).toBe(false);
  });

  test('handles missing and malformed place data safely', () => {
    expect(isKidFriendlySeedCandidate(null)).toBe(false);
    expect(isKidFriendlySeedCandidate({ name: '', types: 'park' })).toBe(false);
  });
});
