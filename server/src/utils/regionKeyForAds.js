'use strict';

/**
 * Canonical key for ad cityId / cityAdSettings lookups: lowercase, hyphenated, no underscores.
 * e.g. "Austin_TX" → "austin-tx", "Omaha NE" → "omaha-ne"
 */
function canonicalRegionKeyForAds(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Values to try when matching `adTargeting.cityId` / `cityAdSettings.cityId` against a client region key.
 * Covers legacy underscore keys and mixed case without requiring DB migrations.
 */
function regionKeyCandidates(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const canonical = canonicalRegionKeyForAds(raw);
  const hyphenFromUnderscore = lower.replace(/_/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-');
  const underscoreFromHyphen = canonical.replace(/-/g, '_');
  return [...new Set([raw, lower, canonical, hyphenFromUnderscore, underscoreFromHyphen])].filter(Boolean);
}

module.exports = { canonicalRegionKeyForAds, regionKeyCandidates };
