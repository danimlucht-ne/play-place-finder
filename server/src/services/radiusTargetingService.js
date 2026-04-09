const { getDb } = require('../database');

const EARTH_RADIUS_MILES = 3958.8;

/**
 * `seeded_regions.center` is either `{ lat, lng }` (admin / legacy) or GeoJSON Point
 * `{ type: 'Point', coordinates: [lng, lat] }` (hybrid search insert). Radius math needs lat/lng.
 * @returns {{ lat: number, lng: number } | null}
 */
function centerToLatLng(center) {
  if (!center) return null;
  if (Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
    return { lat: Number(center.lat), lng: Number(center.lng) };
  }
  if (center.type === 'Point' && Array.isArray(center.coordinates) && center.coordinates.length >= 2) {
    const [lngCoord, latCoord] = center.coordinates;
    if (Number.isFinite(latCoord) && Number.isFinite(lngCoord)) {
      return { lat: latCoord, lng: lngCoord };
    }
  }
  return null;
}

/** Radius surcharges in cents per tier. */
const RADIUS_SURCHARGES = {
  20: 0,
  30: 1500,
  40: 2500,
  50: 3500,
};

/**
 * Haversine distance between two lat/lng points in miles.
 * Symmetric: distance(A,B) === distance(B,A). Returns 0 for identical points.
 */
function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

/**
 * Resolves all regionKeys within a radius from an origin point.
 * Origin priority:
 *   1) explicit coordinates (e.g. advertiser business lat/lng)
 *   2) home region center fallback
 * Falls back to the single closest regionKey if none within radius.
 * @param {string} homeRegionKey
 * @param {number} radiusMiles
 * @param {{lat?: number, lng?: number}=} origin
 * @returns {Promise<{regionKeys: string[], homeCenter: {lat: number, lng: number}}>}
 */
async function resolveRegionKeys(homeRegionKey, radiusMiles = 20, origin = null) {
  const db = getDb();
  const homeRegion = await db.collection('seeded_regions').findOne({ regionKey: homeRegionKey });
  if (!homeRegion || !homeRegion.center) {
    throw new Error(`Home region not found or missing center coordinates: ${homeRegionKey}`);
  }

  const hasExplicitOrigin = Number.isFinite(origin?.lat) && Number.isFinite(origin?.lng);
  const homeCenter = centerToLatLng(homeRegion.center);
  if (!hasExplicitOrigin && !homeCenter) {
    throw new Error(`Home region has no usable center coordinates: ${homeRegionKey}`);
  }
  const homeLat = hasExplicitOrigin ? Number(origin.lat) : homeCenter.lat;
  const homeLng = hasExplicitOrigin ? Number(origin.lng) : homeCenter.lng;

  const allRegions = await db.collection('seeded_regions').find({}).toArray();
  const withDistance = allRegions
    .map((r) => {
      const c = centerToLatLng(r.center);
      return {
        regionKey: r.regionKey,
        distance: c ? haversineDistanceMiles(homeLat, homeLng, c.lat, c.lng) : Infinity,
      };
    })
    .sort((a, b) => a.distance - b.distance);

  const inRange = withDistance.filter((r) => r.distance <= radiusMiles);

  if (inRange.length === 0 && withDistance.length > 0) {
    return { regionKeys: [withDistance[0].regionKey], homeCenter: { lat: homeLat, lng: homeLng } };
  }

  return {
    regionKeys: inRange.map((r) => r.regionKey),
    homeCenter: { lat: homeLat, lng: homeLng },
  };
}

/**
 * Returns a preview of reachable cities at each radius tier (20, 30, 40, 50 miles).
 * Uses the same origin rules as package step-2 / resolveRegionKeys (advertiser lat/lng when set).
 * `selectable` matches server validation: wider tiers only if they add region keys vs 20 mi.
 * @param {string} homeRegionKey
 * @param {{lat?: number, lng?: number}=} origin — advertiser business coordinates when geocoded
 * @returns {Promise<{homeCityName: string, tiers: Array<object>, selectableRadii: number[]}>}
 */
async function getRadiusPreview(homeRegionKey, origin = null) {
  const db = getDb();
  const homeRegion = await db.collection('seeded_regions').findOne({ regionKey: homeRegionKey });
  if (!homeRegion || !homeRegion.center) {
    throw new Error(`Home region not found or missing center coordinates: ${homeRegionKey}`);
  }

  const hasExplicitOrigin = Number.isFinite(origin?.lat) && Number.isFinite(origin?.lng);
  const originCenter = centerToLatLng(homeRegion.center);
  if (!hasExplicitOrigin && !originCenter) {
    throw new Error(`Home region has no usable center coordinates: ${homeRegionKey}`);
  }
  const centerLat = hasExplicitOrigin ? Number(origin.lat) : originCenter.lat;
  const centerLng = hasExplicitOrigin ? Number(origin.lng) : originCenter.lng;

  const allRegions = await db.collection('seeded_regions').find({}).toArray();
  const withDistance = allRegions
    .map((r) => {
      const c = centerToLatLng(r.center);
      return {
        city: r.city,
        regionKey: r.regionKey,
        distance: c ? haversineDistanceMiles(centerLat, centerLng, c.lat, c.lng) : Infinity,
      };
    })
    .filter((r) => r.distance !== Infinity)
    .sort((a, b) => a.distance - b.distance);

  const tierMiles = [20, 30, 40, 50];

  const userCounts = await db.collection('users').aggregate([
    { $match: { regionKey: { $exists: true, $nin: [null, ''] } } },
    {
      $group: {
        _id: { $toLower: { $trim: { input: { $toString: '$regionKey' } } } },
        count: { $sum: 1 },
      },
    },
  ]).toArray();
  const userCountMap = Object.fromEntries(userCounts.map((u) => [u._id, u.count]));

  const reach20 = await resolveRegionKeys(homeRegionKey, 20, origin);
  const baseKeyCount = reach20.regionKeys.length;

  const tiers = [];
  for (const radius of tierMiles) {
    const inRange = withDistance.filter((r) => r.distance <= radius);
    const citySet = new Set(
      inRange
        .map((r) => {
          const label =
            (r.displayCity != null && String(r.displayCity).trim())
              ? String(r.displayCity).trim()
              : (r.city != null && String(r.city).trim())
                ? String(r.city).trim()
                : r.regionKey;
          return label;
        })
        .filter(Boolean),
    );
    const userCount = inRange.reduce((sum, r) => {
      const k = String(r.regionKey || '').toLowerCase();
      return sum + (userCountMap[k] || 0);
    }, 0);
    const reachR = await resolveRegionKeys(homeRegionKey, radius, origin);
    const selectable = radius === 20 || reachR.regionKeys.length > baseKeyCount;
    tiers.push({
      radiusMiles: radius,
      count: inRange.length,
      cities: [...citySet],
      surchargeInCents: RADIUS_SURCHARGES[radius] || 0,
      userCount,
      selectable,
    });
  }

  const selectableRadii = tiers.filter((t) => t.selectable).map((t) => t.radiusMiles);
  return { homeCityName: homeRegion.city, tiers, selectableRadii };
}

module.exports = {
  haversineDistanceMiles,
  centerToLatLng,
  resolveRegionKeys,
  getRadiusPreview,
  RADIUS_SURCHARGES,
};
