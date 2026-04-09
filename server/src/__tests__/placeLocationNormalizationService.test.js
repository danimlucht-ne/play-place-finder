'use strict';

const {
  buildCitySlug,
  normalizePlaceLocation,
  normalizedRegionFromGeocodeResults,
  applyOverride,
} = require('../services/placeLocationNormalizationService');

function comp(long, short, types) {
  return { long_name: long, short_name: short || long, types };
}

describe('placeLocationNormalizationService', () => {
  test('Omaha locality wins over Richland Precinct in administrative_area_level_3', () => {
    const n = normalizePlaceLocation([
      comp('Omaha', 'Omaha', ['locality', 'political']),
      comp('Richland Precinct', 'Richland Precinct', ['administrative_area_level_3', 'political']),
      comp('Douglas County', 'Douglas County', ['administrative_area_level_2', 'political']),
      comp('NE', 'NE', ['administrative_area_level_1', 'political']),
      comp('68102', '68102', ['postal_code']),
    ]);
    expect(n.cityDisplay).toBe('Omaha');
    expect(n.admin.localitySource).toBe('locality');
    expect(n.admin.needsReview).toBe(false);
    expect(n.stateCode).toBe('NE');
  });

  test('Chicago Precinct in aal3 with no locality — null display, needsReview (reverse geocode may fix later)', () => {
    const n = normalizePlaceLocation([
      comp('Chicago Precinct', 'Chicago Precinct', ['administrative_area_level_3', 'political']),
      comp('Douglas County', 'Douglas County', ['administrative_area_level_2', 'political']),
      comp('NE', 'NE', ['administrative_area_level_1', 'political']),
    ]);
    expect(n.cityDisplay).toBeNull();
    expect(n.admin.localitySource).toBe('administrative_area_level_3');
    expect(n.admin.needsReview).toBe(true);
  });

  test('postal_town when locality missing', () => {
    const n = normalizePlaceLocation([
      comp('Sausalito', 'Sausalito', ['postal_town']),
      comp('CA', 'CA', ['administrative_area_level_1']),
    ]);
    expect(n.cityDisplay).toBe('Sausalito');
    expect(n.admin.localitySource).toBe('postal_town');
  });

  test('only administrative_area_level_3 (non-bad name) — use and needsReview', () => {
    const n = normalizePlaceLocation([
      comp('West Omaha', 'West Omaha', ['administrative_area_level_3', 'political']),
      comp('NE', 'NE', ['administrative_area_level_1']),
    ]);
    expect(n.cityDisplay).toBe('West Omaha');
    expect(n.admin.localitySource).toBe('administrative_area_level_3');
    expect(n.admin.needsReview).toBe(true);
  });

  test('slug: Omaha + NE => omaha-ne', () => {
    expect(buildCitySlug('Omaha', 'NE')).toBe('omaha-ne');
    expect(buildCitySlug('  Lincoln  ', 'ne')).toBe('lincoln-ne');
    expect(buildCitySlug("St. Louis", 'MO')).toBe('st-louis-mo');
  });

  test('normalizedRegionFromGeocodeResults picks first result with locality', () => {
    const results = [
      {
        address_components: [
          comp('123', '123', ['street_number']),
          comp('Main St', 'Main St', ['route']),
          comp('NE', 'NE', ['administrative_area_level_1']),
        ],
      },
      {
        address_components: [
          comp('Omaha', 'Omaha', ['locality', 'political']),
          comp('NE', 'NE', ['administrative_area_level_1']),
        ],
      },
    ];
    const n = normalizedRegionFromGeocodeResults(results);
    expect(n.cityDisplay).toBe('Omaha');
    expect(n.citySlug).toBe('omaha-ne');
  });

  test('applyOverride forces display and slug', () => {
    const base = normalizePlaceLocation([
      comp('Bad Precinct', 'Bad Precinct', ['administrative_area_level_3']),
      comp('NE', 'NE', ['administrative_area_level_1']),
    ]);
    const o = {
      forcedCityDisplay: 'Omaha',
      forcedCitySlug: 'omaha-ne',
      forcedStateCode: 'NE',
    };
    const out = applyOverride(o, base);
    expect(out.cityDisplay).toBe('Omaha');
    expect(out.citySlug).toBe('omaha-ne');
    expect(out.stateCode).toBe('NE');
    expect(out.admin.localitySource).toBe('manual_override');
    expect(out.admin.needsReview).toBe(false);
  });
});
