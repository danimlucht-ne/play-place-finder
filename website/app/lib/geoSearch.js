/**
 * Browser geolocation + cache so Discover/Map mirror the mobile app’s proximity search.
 */

export const WEB_LAST_LATLNG_KEY = 'play_spotter_web_last_latlng';

/** Default search radius (miles) — matches app home default after legacy migration. */
export const DEFAULT_SEARCH_RADIUS_MILES = 50;

/** Wider radius when the user is typing a name/city filter (matches HomeScreen). */
export const WIDE_TEXT_SEARCH_RADIUS_MILES = 200;

export function readCachedLatLng() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(WEB_LAST_LATLNG_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    const lat = Number(j.lat);
    const lng = Number(j.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export function writeCachedLatLng(lat, lng) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      WEB_LAST_LATLNG_KEY,
      JSON.stringify({ lat, lng, t: Date.now() }),
    );
  } catch {
    /* ignore quota */
  }
}

/**
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
export function requestBrowserLatLng() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        writeCachedLatLng(lat, lng);
        resolve({ lat, lng });
      },
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 12_000 },
    );
  });
}

/** Earth radius in miles */
const R_MI = 3958.8;

function toRad(d) {
  return (d * Math.PI) / 180;
}

export function haversineMiles(lat1, lng1, lat2, lng2) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) {
    return Number.POSITIVE_INFINITY;
  }
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_MI * c;
}

export function sortPlacesByDistance(rows, lat, lng) {
  const copy = [...rows];
  copy.sort((a, b) => {
    const da = haversineMiles(lat, lng, Number(a.latitude), Number(a.longitude));
    const db = haversineMiles(lat, lng, Number(b.latitude), Number(b.longitude));
    return da - db;
  });
  return copy;
}
