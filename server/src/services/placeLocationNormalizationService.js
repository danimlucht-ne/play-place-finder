'use strict';

const axios = require('axios');

/** Bump when normalization rules change; migration and enrichment re-run when mismatched. */
const NORMALIZATION_VERSION = 1;

const GEOCODE_HTTP_TIMEOUT_MS = 15000;

/** Substrings that must not be used as the primary city label when a better locality exists. */
const BAD_CITY_SUBSTRINGS = [
  'precinct',
  'township',
  'census designated place',
  'unorganized territory',
];

function containsBadAdministrativeLabel(str) {
  const s = String(str || '').toLowerCase();
  return BAD_CITY_SUBSTRINGS.some((b) => s.includes(b));
}

/**
 * Stable slug: omaha + NE → omaha-ne
 * @param {string} cityDisplay
 * @param {string} stateCode — 2-letter preferred
 */
function buildCitySlug(cityDisplay, stateCode) {
  if (!cityDisplay || !stateCode) return '';
  const cityPart = String(cityDisplay)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const st = String(stateCode)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
  if (!cityPart || !st) return '';
  return `${cityPart}-${st}`;
}

function getComponent(components, type) {
  if (!Array.isArray(components)) return null;
  return components.find((ac) => ac.types && ac.types.includes(type)) || null;
}

function longName(components, type) {
  const c = getComponent(components, type);
  return c && c.long_name ? String(c.long_name).trim() : '';
}

function shortName(components, type) {
  const c = getComponent(components, type);
  return c && c.short_name ? String(c.short_name).trim() : '';
}

/**
 * Core normalization from Google address_components (Place Details or Geocode).
 * Priority for cityDisplay: locality → postal_town → administrative_area_level_3 → null.
 *
 * @param {Array<{long_name:string,short_name:string,types:string[]}>} addressComponents
 * @returns {{
 *   cityDisplay: string|null,
 *   citySlug: string,
 *   stateCode: string|null,
 *   countyDisplay: string|null,
 *   postalCode: string|null,
 *   neighborhood: string|null,
 *   metroArea: null,
 *   admin: { localitySource: string|null, needsReview: boolean, normalizationVersion: number }
 * }}
 */
function normalizePlaceLocation(addressComponents) {
  const comps = addressComponents || [];

  const localityRaw = longName(comps, 'locality');
  const postalTownRaw = longName(comps, 'postal_town');
  const aal3Raw = longName(comps, 'administrative_area_level_3');

  const localityOk = localityRaw && !containsBadAdministrativeLabel(localityRaw);
  const postalTownOk = postalTownRaw && !containsBadAdministrativeLabel(postalTownRaw);

  let cityDisplay = null;
  let localitySource = null;
  let needsReview = false;

  if (localityOk) {
    cityDisplay = localityRaw;
    localitySource = 'locality';
  } else if (postalTownOk) {
    cityDisplay = postalTownRaw;
    localitySource = 'postal_town';
    if (localityRaw && containsBadAdministrativeLabel(localityRaw)) {
      needsReview = true;
    }
  } else if (aal3Raw) {
    localitySource = 'administrative_area_level_3';
    needsReview = true;
    if (containsBadAdministrativeLabel(aal3Raw)) {
      cityDisplay = null;
    } else {
      cityDisplay = aal3Raw;
    }
  } else if (localityRaw) {
    // Only "bad" locality string available
    cityDisplay = null;
    localitySource = 'locality';
    needsReview = true;
  }

  const stateCode = shortName(comps, 'administrative_area_level_1') || null;
  const countyDisplay = longName(comps, 'administrative_area_level_2') || null;
  const postalCode = longName(comps, 'postal_code') || null;

  const neighborhood =
    longName(comps, 'neighborhood') ||
    longName(comps, 'sublocality') ||
    longName(comps, 'sublocality_level_1') ||
    null;

  const citySlug = buildCitySlug(cityDisplay || '', stateCode || '');

  return {
    cityDisplay,
    citySlug: citySlug || null,
    stateCode,
    countyDisplay,
    postalCode,
    neighborhood,
    metroArea: null,
    admin: {
      localitySource,
      needsReview,
      normalizationVersion: NORMALIZATION_VERSION,
    },
  };
}

/**
 * Apply manual override from `locationOverrides` collection doc.
 */
function applyOverride(override, base) {
  if (!override) return base;
  const cityDisplay = override.forcedCityDisplay != null && String(override.forcedCityDisplay).trim()
    ? String(override.forcedCityDisplay).trim()
    : base.cityDisplay;
  const stateCode =
    override.forcedStateCode != null && String(override.forcedStateCode).trim()
      ? String(override.forcedStateCode).trim()
      : base.stateCode;
  let citySlug = override.forcedCitySlug != null && String(override.forcedCitySlug).trim()
    ? String(override.forcedCitySlug).trim().toLowerCase()
    : base.citySlug;
  if (override.forcedCitySlug == null && cityDisplay && stateCode) {
    citySlug = buildCitySlug(cityDisplay, stateCode) || base.citySlug;
  }
  return {
    ...base,
    cityDisplay,
    citySlug: citySlug || null,
    stateCode,
    admin: {
      ...base.admin,
      localitySource: 'manual_override',
      needsReview: false,
      normalizationVersion: NORMALIZATION_VERSION,
    },
  };
}

async function loadOverride(db, googlePlaceId) {
  if (!googlePlaceId || !db) return null;
  return db.collection('locationOverrides').findOne({ googlePlaceId: String(googlePlaceId) });
}

/**
 * @param {import('mongodb').Db|null} db
 * @param {string} googlePlaceId
 * @param {{ address_components?: any[], formatted_address?: string }} detailsResult — Place Details `result`
 * @param {{ lat: number, lng: number }} coords
 * @param {string} [apiKey] — GOOGLE_MAPS_API_KEY
 */
async function normalizePlaygroundFromGoogleDetails(db, googlePlaceId, detailsResult, coords, apiKey) {
  const key = apiKey || process.env.GOOGLE_MAPS_API_KEY;
  let components = detailsResult && Array.isArray(detailsResult.address_components)
    ? detailsResult.address_components
    : [];

  let norm = normalizePlaceLocation(components);
  let usedReverseGeocode = false;

  const weakCity =
    !norm.cityDisplay ||
    containsBadAdministrativeLabel(norm.cityDisplay || '');

  if (weakCity && key && coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    const rgComps = await reverseGeocodeAddressComponents(coords.lat, coords.lng, key);
    if (rgComps && rgComps.length) {
      const norm2 = normalizePlaceLocation(rgComps);
      if (norm2.cityDisplay && !containsBadAdministrativeLabel(norm2.cityDisplay)) {
        norm = norm2;
        usedReverseGeocode = true;
      } else if (norm2.cityDisplay && !norm.cityDisplay) {
        norm = norm2;
        usedReverseGeocode = true;
      }
    }
  }

  const override = await loadOverride(db, googlePlaceId);
  norm = applyOverride(override, norm);

  const countryComp = getComponent(components, 'country');
  const regionCode = countryComp && countryComp.short_name ? countryComp.short_name : null;

  const googleRaw = {
    formattedAddress: detailsResult?.formatted_address || null,
    addressComponents: components,
    regionCode,
  };

  if (usedReverseGeocode) {
    googleRaw.reverseGeocodeUsed = true;
  }

  return {
    googleRaw,
    normalized: {
      cityDisplay: norm.cityDisplay,
      citySlug: norm.citySlug,
      stateCode: norm.stateCode,
      countyDisplay: norm.countyDisplay,
      postalCode: norm.postalCode,
      neighborhood: norm.neighborhood,
      metroArea: norm.metroArea,
    },
    admin: norm.admin,
  };
}

async function reverseGeocodeAddressComponents(lat, lng, key) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`;
    const response = await axios.get(url, { timeout: GEOCODE_HTTP_TIMEOUT_MS });
    if (response.data.status !== 'OK' || !response.data.results?.length) return null;
    const first = response.data.results[0];
    return first.address_components || null;
  } catch (_) {
    return null;
  }
}

/**
 * Geocode results → display fields for `seeded_regions`.
 * Tries each result in order so a street-level hit is not stuck without locality when a later
 * political result includes `locality`.
 */
function normalizedRegionFromGeocodeResults(results) {
  if (!results || !results.length) {
    return {
      cityDisplay: null,
      citySlug: null,
      stateCode: null,
      admin: { localitySource: null, needsReview: true, normalizationVersion: NORMALIZATION_VERSION },
    };
  }
  for (let i = 0; i < results.length; i += 1) {
    const comps = results[i].address_components;
    if (!Array.isArray(comps) || comps.length === 0) continue;
    const norm = normalizePlaceLocation(comps);
    if (norm.cityDisplay) {
      return {
        cityDisplay: norm.cityDisplay,
        citySlug: norm.citySlug,
        stateCode: norm.stateCode,
        admin: norm.admin,
      };
    }
  }
  const last = results[0].address_components;
  const norm = normalizePlaceLocation(last);
  return {
    cityDisplay: norm.cityDisplay,
    citySlug: norm.citySlug,
    stateCode: norm.stateCode,
    admin: norm.admin,
  };
}

module.exports = {
  NORMALIZATION_VERSION,
  BAD_CITY_SUBSTRINGS,
  buildCitySlug,
  normalizePlaceLocation,
  normalizePlaygroundFromGoogleDetails,
  reverseGeocodeAddressComponents,
  normalizedRegionFromGeocodeResults,
  applyOverride,
  loadOverride,
};
