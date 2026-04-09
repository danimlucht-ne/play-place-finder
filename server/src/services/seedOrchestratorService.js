// services/seedOrchestratorService.js
const { getDb } = require('../database');
const axios = require('axios');
const adminNotificationService = require('./adminNotificationService');
const { getGeminiSummary, getGeminiLocationValidation, getGeminiDescription } = require('./photoClassificationService');
const { classifyPlaceForValidation } = require('./placeValidityRules');
const { getManyCached, setCached } = require('./locationValidationCache');
const { isKidFriendlySeedCandidate } = require('./kidPlaceFilters');
const { inferPlaygroundType } = require('./inferPlaygroundType');
const { detectFaces, applyStickerMasks } = require('./faceStickerMaskService');
const { publicBucket, uploadBufferToPublic } = require('./storageService');
const {
    validate, shouldQueueForReview, computePhotoScore, rerankGallery,
    deduplicateGallery, computePhash,
} = require('./equipmentValidationService');
const {
    NORMALIZATION_VERSION: LOCATION_NORMALIZATION_VERSION,
    normalizedRegionFromGeocodeResults,
    normalizePlaygroundFromGoogleDetails,
} = require('./placeLocationNormalizationService');
const { ACTIVE_PLAYGROUND_FILTER } = require('./activePlaygroundFilter');
const {
    FAST_SEED_SEARCHES,
    BACKGROUND_EXPANSION_SEARCHES,
    CAMPUS_SUBVENUE_SEARCHES,
} = require('./seedSearchProfiles');
const { enqueueLightRefreshIfNeeded } = require('./seedJobQueueService');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Hero photos at or above this minimum on every Gemini dimension (0–1) skip seed review unless
 * masking fails or the model asks for human review. Default 0.7 = 70%.
 */
function parseSeedReviewQualityMin() {
    const v = parseFloat(process.env.SEED_REVIEW_QUALITY_MIN ?? '0.7', 10);
    if (Number.isNaN(v) || v < 0 || v > 1) return 0.7;
    return v;
}

/** Weakest link among model scores — any low value means the photo should not auto-clear review. */
function geminiSummaryQualityMin(gs) {
    if (!gs) return 0;
    const nums = [gs.relevanceScore, gs.overviewScore, gs.confidence].filter(
        (x) => typeof x === 'number' && !Number.isNaN(x),
    );
    if (nums.length === 0) return 0;
    return Math.min(...nums);
}

/**
 * Human-readable reasons for admin seed photo review (shown in app).
 * @param {object} p
 * @param {boolean} p.maskingFailed
 * @param {boolean} p.topNeedsHuman
 * @param {object} p.gs geminiSummary
 * @param {number} p.combinedVisual
 * @param {number} p.qualityMin
 * @param {number} p.scoreThreshold
 * @returns {string[]}
 */
function buildSeedReviewQueueReasons(p) {
    const reasons = [];
    const gs = p.gs || {};
    const action = String(gs.recommendedAction || '');
    if (p.maskingFailed) {
        reasons.push(
            'Face masking failed: sticker upload or face detection pipeline failed; visible faces may remain — replace image or confirm masking before approving.',
        );
    }
    if (p.topNeedsHuman) {
        if (action === 'NEEDS_ADMIN_REVIEW') {
            reasons.push('Model requested review: recommendedAction is NEEDS_ADMIN_REVIEW (check notes below).');
        } else if (action === 'REJECT') {
            reasons.push('Model flagged reject: recommendedAction is REJECT (check notes — may still be borderline).');
        } else if (action) {
            reasons.push(`Model action: recommendedAction="${action}".`);
        }
        if (p.combinedVisual < 0.42) {
            reasons.push(
                `Weak scene match for hero: combined visual ${p.combinedVisual.toFixed(2)} < 0.42 (60%×relevance + 40%×overview). Improve hero choice or SEED_REVIEW thresholds.`,
            );
        }
        if (p.qualityMin < p.scoreThreshold) {
            reasons.push(
                `Lowest Gemini score below auto-pass: min(relevance, overview, confidence) = ${p.qualityMin.toFixed(2)} < ${p.scoreThreshold} (SEED_REVIEW_QUALITY_MIN). UI chips may hide overview — compare all three in raw summary.`,
            );
        }
    }
    if (reasons.length === 0 && (p.maskingFailed || p.topNeedsHuman)) {
        reasons.push('Queued for seed review (see geminiSummary and flags on this item).');
    }
    return reasons;
}

/**
 * Bump when changing Places fetch or post-fetch filters so legacy `seeded_regions` run a lightweight re-crawl.
 * Missing `seedAlgorithmVersion` on a region is treated as 0 (always < this).
 *
 * TODO: Increment this integer every time you change any of: fetchGooglePlaces (incl. pagination),
 * backgroundExpansionSearches / fast-seed query tuples, normalizeAndDedupe, kidPlaceFilters, or grid/radius
 * constants that affect which POIs are discovered — so enqueueStaleAlgorithmRecrawlIfNeeded can backfill.
 */
const SEED_ALGORITHM_VERSION = 5;

/** Google requires a short delay before `pagetoken` returns results (docs ~2s). */
const GOOGLE_NEARBY_PAGE_DELAY_MS = 2100;

function getNearbyExtraPageCap() {
    const n = parseInt(process.env.GOOGLE_PLACES_NEARBY_EXTRA_PAGES ?? '2', 10);
    if (Number.isNaN(n)) return 2;
    return Math.max(0, Math.min(5, n));
}

function envInt(name, fallback, min, max) {
    const value = parseInt(process.env[name] || '', 10);
    if (Number.isNaN(value)) return fallback;
    return Math.max(min, Math.min(max, value));
}

/** `seeded_regions.center` may be GeoJSON Point or legacy { lat, lng }. */
function seededRegionCenterToLatLng(center) {
    if (!center) return null;
    if (typeof center.lat === 'number' && typeof center.lng === 'number') {
        return { lat: center.lat, lng: center.lng };
    }
    if (Array.isArray(center.coordinates) && center.coordinates.length >= 2) {
        const [lng, lat] = center.coordinates;
        if (typeof lat === 'number' && typeof lng === 'number') {
            return { lat, lng };
        }
    }
    return null;
}

function regionSeedAlgorithmVersion(regionDoc) {
    const v = Number(regionDoc?.seedAlgorithmVersion);
    return Number.isFinite(v) ? v : 0;
}

/**
 * Normalizes a city/state into a reusable key.
 * e.g., "Omaha", "NE" -> "omaha-ne"
 */
function normalizeRegionKey(city, state) {
    const cleanCity = city.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const cleanState = state.toLowerCase().replace(/ /g, '');
    return `${cleanCity}-${cleanState}`;
}

/** Outbound Google Geocoding — must not hang forever (mobile clients use ~30–120s HTTP timeouts). */
const GEOCODE_HTTP_TIMEOUT_MS = 15000;

/**
 * Geocodes a latitude/longitude to find city, state, and viewport.
 */
async function geocodeLatLng(lat, lng) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
        console.error("CRITICAL: GOOGLE_MAPS_API_KEY is missing from environment variables!");
        throw new Error("Server configuration error: Missing API Key.");
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`;
    const response = await axios.get(url, { timeout: GEOCODE_HTTP_TIMEOUT_MS });
    const results = response.data.results;

    if (!results || results.length === 0 || response.data.status !== "OK") {
        console.error("Geocoding failed for coordinates:", { lat, lng });
        console.error("Google API Status:", response.data.status);
        console.error("Google API Error Message:", response.data.error_message || "No error message provided");
        throw new Error(`Could not geocode coordinates. Status: ${response.data.status}`);
    }

    const first = results[0];
    const viewport = first.geometry?.viewport || null;
    const nr = normalizedRegionFromGeocodeResults(results);
    const countryComp = first.address_components?.find((ac) => ac.types?.includes('country'));
    const country = countryComp?.short_name || 'Unknown';
    const city = nr.cityDisplay || 'Unknown';
    const state = nr.stateCode || 'Unknown';

    return { city, state, country, viewport, normalizedRegion: nr };
}

/**
 * Geocodes a text query (e.g. "Austin, TX") to lat/lng + city/state/country.
 * Forward geocoding counterpart to geocodeLatLng (which does reverse geocoding).
 */
async function geocodeTextQuery(query) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
        console.error("CRITICAL: GOOGLE_MAPS_API_KEY is missing from environment variables!");
        throw new Error("Server configuration error: Missing API Key.");
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`;
    const response = await axios.get(url, { timeout: GEOCODE_HTTP_TIMEOUT_MS });
    const results = response.data.results;

    if (!results || results.length === 0 || response.data.status !== "OK") {
        console.error("Geocoding failed for query:", query);
        console.error("Google API Status:", response.data.status);
        console.error("Google API Error Message:", response.data.error_message || "No error message provided");
        throw new Error(`Could not geocode location: "${query}". Status: ${response.data.status}`);
    }

    const result = results[0];
    const { lat, lng } = result.geometry.location;

    const nr = normalizedRegionFromGeocodeResults(results);
    const countryComp = result.address_components?.find((ac) => ac.types?.includes('country'));
    const country = countryComp?.short_name || 'Unknown';
    const city = nr.cityDisplay || 'Unknown';
    const state = nr.stateCode || 'Unknown';

    // Limit to USA only
    if (country !== 'US') {
        throw new Error('Play Place Finder is currently available in the United States only.');
    }

    return { lat, lng, city, state, country, normalizedRegion: nr };
}

const { retryWithBackoff } = require('./retryWithBackoff');

/** Set `SEED_LOG_RAW_NEARBY_PLACES=1` to log one JSON line per Nearby result (name, place_id, types, location). */
function shouldLogRawNearbyPlaces() {
    return String(process.env.SEED_LOG_RAW_NEARBY_PLACES || '').trim() === '1';
}

/**
 * Fetches places from Google Places API for a given radius and type set.
 * Uses exponential backoff on rate limit / server errors.
 * Optionally follows next_page_token (capped) when the first page is full (20 results).
 */
async function fetchGooglePlaces(lat, lng, radiusMeters, searches) {
    const maxExtraPages = getNearbyExtraPageCap();
    const places = [];
    let loggedFirstRequestDenied = false;
    for (const s of searches) {
        const typeParam = s.type ? `&type=${encodeURIComponent(s.type)}` : '';
        const keywordParam = s.keyword ? `&keyword=${encodeURIComponent(s.keyword)}` : '';
        const baseUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}${typeParam}${keywordParam}&key=${GOOGLE_MAPS_API_KEY}`;
        const searchLabel = [s.type || '', s.keyword || ''].filter(Boolean).join('|') || '(keyword-only)';
        try {
            let pageUrl = baseUrl;
            let extraPagesFetched = 0;
            while (true) {
                const response = await retryWithBackoff(
                    () => axios.get(pageUrl),
                    { maxRetries: 3, baseDelayMs: 2000, label: `places-${s.type || s.keyword}` },
                );
                const data = response.data || {};
                const batch = data.results || [];
                const errMsg = data.error_message
                    ? String(data.error_message)
                    : null;
                if (data.status === 'REQUEST_DENIED' && errMsg && !loggedFirstRequestDenied) {
                    loggedFirstRequestDenied = true;
                    console.error(
                        '[seed] Google Places Nearby Search REQUEST_DENIED (all searches will return empty):',
                        errMsg,
                    );
                }
                if (shouldLogRawNearbyPlaces()) {
                    const pageLabel = extraPagesFetched === 0 ? 'page0' : `page${extraPagesFetched}`;
                    for (const p of batch) {
                        const loc = p.geometry && p.geometry.location;
                        console.log(
                            '[seed][nearby-raw]',
                            JSON.stringify({
                                center: { lat, lng },
                                radiusMeters,
                                search: searchLabel,
                                page: pageLabel,
                                status: data.status,
                                error_message: errMsg,
                                name: p.name,
                                place_id: p.place_id,
                                types: p.types,
                                lat: loc && loc.lat,
                                lng: loc && loc.lng,
                                vicinity: p.vicinity,
                            }),
                        );
                    }
                    if (batch.length === 0) {
                        console.log(
                            '[seed][nearby-raw]',
                            JSON.stringify({
                                center: { lat, lng },
                                radiusMeters,
                                search: searchLabel,
                                page: pageLabel,
                                status: data.status,
                                error_message: errMsg,
                                message: 'empty batch',
                            }),
                        );
                    }
                }
                places.push(...batch);
                const token = data.next_page_token;
                const canPaginate =
                    maxExtraPages > 0 &&
                    token &&
                    batch.length === 20 &&
                    extraPagesFetched < maxExtraPages;
                if (!canPaginate) break;
                extraPagesFetched += 1;
                await new Promise((r) => setTimeout(r, GOOGLE_NEARBY_PAGE_DELAY_MS));
                pageUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${encodeURIComponent(token)}&key=${GOOGLE_MAPS_API_KEY}`;
            }
        } catch (error) {
            console.error(`Error fetching Google Places for ${s.type || 'any'} / ${s.keyword || 'no-keyword'}:`, error.message);
        }
        // Small delay between search types to avoid burst rate limiting
        await new Promise((r) => setTimeout(r, 500));
    }
    return places;
}

/** Same search tuples as enqueueBackgroundExpansion (grid pass). */
function backgroundExpansionSearches() {
    return [...BACKGROUND_EXPANSION_SEARCHES];
}

const CAMPUS_PARENT_NAME_RE = /\b(zoo|aquarium|children'?s?\s+museum|science\s+center|museum|amusement\s+park|botanical\s+garden)\b/i;
const CAMPUS_PARENT_TYPES = new Set(['zoo', 'aquarium', 'museum', 'amusement_park']);

function placeLatLng(place) {
    const coords = place?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const [lng, lat] = coords;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng };
}

function isCampusAnchorForDiscovery(place) {
    const name = String(place?.name || '');
    const playgroundType = String(place?.playgroundType || '');
    const types = Array.isArray(place?.types) ? place.types.map((t) => String(t).toLowerCase()) : [];
    const hasCampusType = types.some((t) => CAMPUS_PARENT_TYPES.has(t));
    return Boolean(placeLatLng(place)) && (CAMPUS_PARENT_NAME_RE.test(name) || CAMPUS_PARENT_NAME_RE.test(playgroundType) || hasCampusType);
}

function campusSubvenueSearchesForAnchor(anchor) {
    const searches = [...CAMPUS_SUBVENUE_SEARCHES];
    const anchorName = String(anchor?.name || '')
        .replace(/[^\w\s'&-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (anchorName) {
        searches.push({ type: 'tourist_attraction', keyword: `${anchorName} exhibit` });
        searches.push({ keyword: `${anchorName} habitat` });
        searches.push({ keyword: `${anchorName} aquarium` });
    }

    const seen = new Set();
    return searches.filter((search) => {
        const key = `${search.type || ''}|${search.keyword || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function discoverCampusSubvenues(regionKey, options = {}) {
    const db = options.db || getDb();
    const radiusMeters = options.radiusMeters ?? envInt('SEED_CAMPUS_SUBVENUE_RADIUS_METERS', 1400, 250, 5000);
    const maxAnchors = options.maxAnchors ?? envInt('SEED_CAMPUS_SUBVENUE_MAX_ANCHORS', 8, 1, 50);
    const maxNearbyCalls = options.maxNearbyCalls ?? envInt('SEED_CAMPUS_SUBVENUE_MAX_NEARBY_CALLS', 12, 1, 100);

    const anchors = await db.collection('playgrounds').find({
        regionKey,
        archivedAt: { $exists: false },
        status: { $ne: 'closed' },
        location: { $exists: true },
        $or: [
            { types: { $in: Array.from(CAMPUS_PARENT_TYPES) } },
            { name: { $regex: CAMPUS_PARENT_NAME_RE } },
            { playgroundType: { $regex: CAMPUS_PARENT_NAME_RE } },
        ],
    }).limit(maxAnchors).toArray();

    const usableAnchors = anchors.filter(isCampusAnchorForDiscovery).slice(0, maxAnchors);
    const raw = [];
    let googleNearbyCalls = 0;

    for (const anchor of usableAnchors) {
        const center = placeLatLng(anchor);
        if (!center) continue;
        const searches = campusSubvenueSearchesForAnchor(anchor);
        for (const search of searches) {
            if (googleNearbyCalls >= maxNearbyCalls) break;
            const places = await fetchGooglePlaces(center.lat, center.lng, radiusMeters, [search]);
            raw.push(...places);
            googleNearbyCalls += 1;
        }
        if (googleNearbyCalls >= maxNearbyCalls) break;
    }

    const candidates = normalizeAndDedupe(raw, regionKey);
    const toUpsert = await filterOutPlacesArchivedAfterMerge(db, candidates);
    let candidatesInserted = 0;
    if (toUpsert.length > 0) {
        const result = await db.collection('playgrounds').bulkWrite(toUpsert.map((p) => ({
            updateOne: {
                filter: { _id: p._id },
                update: { $setOnInsert: { ...p, status: p.status || 'active' } },
                upsert: true,
            },
        })));
        candidatesInserted = result.upsertedCount || 0;
    }

    return {
        anchorsScanned: usableAnchors.length,
        googleNearbyCalls,
        candidatesScanned: candidates.length,
        candidatesInserted,
        placesSkipped: Math.max(0, candidates.length - candidatesInserted),
    };
}

function clampNumber(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
}

/**
 * @param {object} viewport - Google `geometry.viewport` (or flat SW/NE) from geocode/seeded_regions
 * @returns {{ swLat: number, swLng: number, neLat: number, neLng: number } | null}
 */
function extractBoundsFromViewport(viewport) {
    if (!viewport || typeof viewport !== 'object') return null;
    const ne = viewport.northeast || viewport.northEast;
    const sw = viewport.southwest || viewport.southWest;
    if (ne && sw && [ne.lat, ne.lng, sw.lat, sw.lng].every((x) => Number.isFinite(x))) {
        return { swLat: sw.lat, swLng: sw.lng, neLat: ne.lat, neLng: ne.lng };
    }
    if (
        [viewport.southWestLat, viewport.southWestLng, viewport.northEastLat, viewport.northEastLng].every(
            (x) => Number.isFinite(x),
        )
    ) {
        return {
            swLat: viewport.southWestLat,
            swLng: viewport.southWestLng,
            neLat: viewport.northEastLat,
            neLng: viewport.northEastLng,
        };
    }
    return null;
}

/**
 * Build up to [maxPoints] grid centers inside the map viewport (lat/lng box), using the same ~10 mi
 * step as [buildGrid3x3]. Steps up spacing if the box would need more than [maxPoints] cells.
 * @param {number} maxPoints — caps Google Nearby calls (each point runs full BACKGROUND_EXPANSION_SEARCHES).
 * @param {{ allowLargeMetros?: boolean } | undefined} [layoutOptions] — `allowLargeMetros` skips the strict admin-map span guard
 *   for geocode-sized city bounds (see SEED_METRO_MAX_*_CENTIDEG).
 * @returns {{ points: {lat,lng}[], rows: number, cols: number, sLat: number, nLat: number, sLng: number, eLng: number, cosLat: number }}
 * @throws {Error} code BAD_BOUNDS | VIEWPORT_TOO_LARGE
 */
function computeBoundsGridLayout(swLat, swLng, neLat, neLng, maxPoints = 12, layoutOptions = {}) {
    const sLat = Math.min(swLat, neLat);
    const nLat = Math.max(swLat, neLat);
    const sLng = Math.min(swLng, neLng);
    const eLng = Math.max(swLng, neLng);
    const latSpan = nLat - sLat;
    const lngSpan = eLng - sLng;
    if (!Number.isFinite(latSpan) || !Number.isFinite(lngSpan) || latSpan <= 0 || lngSpan <= 0) {
        const err = new Error('Invalid viewport bounds');
        err.code = 'BAD_BOUNDS';
        throw err;
    }
    const latMid = (sLat + nLat) / 2;
    const cosLat = Math.max(Math.cos((latMid * Math.PI) / 180), 0.35);
    if (layoutOptions && layoutOptions.allowLargeMetros) {
        const maxLat = envInt('SEED_METRO_MAX_LAT_CENTIDEG', 200, 50, 500) / 100;
        const maxLng = envInt('SEED_METRO_MAX_LNG_CENTIDEG', 300, 50, 800) / 100;
        if (latSpan > maxLat || lngSpan > maxLng) {
            const err = new Error(
                `Geocode metro viewport is larger than SEED_METRO_MAX_* (${maxLat}° / ${maxLng}°)`,
            );
            err.code = 'METRO_VIEWPORT_TOO_LARGE';
            throw err;
        }
    } else {
        // Roughly cap at ~17 mi N–S and ~22 mi E–W at mid-latitudes so one action cannot fan out too wide.
        if (latSpan > 0.24 || lngSpan > 0.32 / cosLat) {
            const err = new Error('Map view is too large. Zoom in closer, then try again.');
            err.code = 'VIEWPORT_TOO_LARGE';
            throw err;
        }
    }
    const baseStepLat = 10 / 69.0;
    const baseStepLng = 10 / (69.0 * cosLat);
    let stepLat = baseStepLat;
    let stepLng = baseStepLng;
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const rows = Math.max(1, Math.ceil((latSpan + 1e-9) / stepLat));
        const cols = Math.max(1, Math.ceil((lngSpan + 1e-9) / stepLng));
        if (rows * cols <= maxPoints) {
            const pts = [];
            for (let i = 0; i < rows; i += 1) {
                for (let j = 0; j < cols; j += 1) {
                    const lat = clampNumber(sLat + (i + 0.5) * stepLat, sLat, nLat);
                    const lng = clampNumber(sLng + (j + 0.5) * stepLng, sLng, eLng);
                    pts.push({ lat, lng });
                }
            }
            return { points: pts, rows, cols, sLat, nLat, sLng, eLng, cosLat };
        }
        stepLat *= 1.12;
        stepLng *= 1.12;
    }
    const err = new Error('Could not fit viewport to seed grid; zoom in and retry.');
    err.code = 'VIEWPORT_TOO_LARGE';
    throw err;
}

/** @returns {{ lat: number, lng: number }[]} */
function generateSearchGridForBounds(swLat, swLng, neLat, neLng, maxPoints = 12) {
    return computeBoundsGridLayout(swLat, swLng, neLat, neLng, maxPoints).points;
}

/**
 * Per-cell radius for first-time / algorithm background grid (larger than interactive viewport cells).
 * Uses half the cell diagonal (meters) + padding, clamped.
 * @param {object} layout — from [computeBoundsGridLayout] with `allowLargeMetros`
 */
function nearbyRadiusMetersForBackgroundGrid(layout) {
    const { rows, cols, sLat, nLat, sLng, eLng, cosLat } = layout;
    const latSpan = nLat - sLat;
    const lngSpan = eLng - sLng;
    const nsMetersPerDeg = 111320;
    const cellHeightM = (latSpan / rows) * nsMetersPerDeg;
    const cellWidthM = (lngSpan / cols) * nsMetersPerDeg * cosLat;
    const halfCellDiagM = 0.5 * Math.hypot(cellHeightM, cellWidthM);
    const padded = halfCellDiagM * 1.12;
    const minR = envInt('SEED_BG_GRID_RADIUS_MIN_METERS', 12000, 3000, 50000);
    const maxR = envInt('SEED_BG_GRID_RADIUS_MAX_METERS', 32000, 8000, 80000);
    return Math.round(clampNumber(padded, minR, maxR));
}

/**
 * Nearby Search radius for one grid cell: half the cell diagonal (meters) + padding, clamped.
 * Replaces a fixed ~15 mi radius so small map views do not query the whole metro.
 */
function nearbyRadiusMetersForViewportGrid(layout) {
    const { rows, cols, sLat, nLat, sLng, eLng, cosLat } = layout;
    const latSpan = nLat - sLat;
    const lngSpan = eLng - sLng;
    const nsMetersPerDeg = 111320;
    const cellHeightM = (latSpan / rows) * nsMetersPerDeg;
    const cellWidthM = (lngSpan / cols) * nsMetersPerDeg * cosLat;
    const halfCellDiagM = 0.5 * Math.hypot(cellHeightM, cellWidthM);
    const padded = halfCellDiagM * 1.12;
    const minR = envInt('SEED_VIEWPORT_NEARBY_RADIUS_MIN_METERS', 200, 50, 5000);
    const maxR = envInt('SEED_VIEWPORT_NEARBY_RADIUS_MAX_METERS', 12000, 200, 50000);
    return Math.round(clampNumber(padded, minR, maxR));
}

/**
 * Places grid crawl for the visible map rectangle only (upserts + campus discovery + venue merge).
 * Does not touch algorithmRecrawlInFlight (separate from scheduled lightweight algorithm recrawl).
 */
/**
 * Merge-only: campus discovery + canonicalize (no Google viewport grid). For admin "reconcile" mode.
 */
async function runViewportReconcileForRegion(regionKey, meta = {}) {
  const db = getDb();
  const campusDiscovery = await discoverCampusSubvenues(regionKey, { db });
  let canonicalization = null;
  try {
    const { canonicalizeRegionVenues } = require('./venueMergeService');
    canonicalization = await canonicalizeRegionVenues(regionKey);
  } catch (mergeErr) {
    canonicalization = { errorMessage: mergeErr.message };
  }
  await db.collection('seeded_regions').updateOne(
    { regionKey },
    {
      $set: {
        lastViewportReconcileAt: new Date(),
        lastViewportReconcile: {
          ...meta,
          campusDiscovery,
          canonicalization,
        },
      },
    },
  );
  const { appendRunLog } = require('./seedRunLogService');
  await appendRunLog(db, {
    regionKey,
    runType: 'viewport_reconcile',
    status: canonicalization?.errorMessage ? 'partial' : 'complete',
    meta: { ...meta, campusDiscovery, canonicalization },
  });
}

/**
 * Compact rows for [lastViewportSeed.candidatesPreview] — admin review (re-run viewport to refresh).
 * @param {object} p — normalized playground doc from [normalizeAndDedupe]
 */
function compactPlaceForViewportReview(p) {
    const coords = p.location && p.location.coordinates;
    const lng = Array.isArray(coords) ? coords[0] : null;
    const lat = Array.isArray(coords) ? coords[1] : null;
    return {
        placeId: p._id != null ? String(p._id) : null,
        name: p.name || '',
        lat,
        lng,
        primaryType: p.primaryType || null,
        playgroundType: p.playgroundType || null,
        addressSnippet: p.googleRaw && p.googleRaw.formattedAddress
            ? String(p.googleRaw.formattedAddress)
            : null,
    };
}

/**
 * When the app filter uses a sub-metro key (e.g. papillion-ne) that has no `seeded_regions` row,
 * fall back to the nearest seeded metro (e.g. omaha-ne) if the map viewport center is within
 * SEED_VIEWPORT_REGION_FALLBACK_MAX_METERS (default 120 km).
 */
async function resolveNearestSeededRegionForMapViewport(db, centerLat, centerLng) {
    const maxMeters = envInt('SEED_VIEWPORT_REGION_FALLBACK_MAX_METERS', 120000, 5000, 800000);
    const venueMergeService = require('./venueMergeService');
    const regions = await db
        .collection('seeded_regions')
        .find({ seedStatus: { $nin: ['failed'] } })
        .project({ regionKey: 1, center: 1 })
        .toArray();

    let bestKey = null;
    let bestDist = Infinity;
    for (const reg of regions) {
        const c = seededRegionCenterToLatLng(reg.center);
        if (!c) continue;
        const d = venueMergeService.haversineMeters(centerLat, centerLng, c.lat, c.lng);
        if (d < bestDist) {
            bestDist = d;
            bestKey = reg.regionKey;
        }
    }
    if (bestKey != null && bestDist <= maxMeters) {
        return { regionKey: bestKey, distanceMeters: Math.round(bestDist) };
    }
    return null;
}

function resolveViewportSeedRadiusMeters(meta) {
    if (meta && Number.isFinite(meta.nearbyRadiusMeters) && meta.nearbyRadiusMeters > 0) {
        return Math.round(meta.nearbyRadiusMeters);
    }
    if (
        meta
        && [meta.southWestLat, meta.southWestLng, meta.northEastLat, meta.northEastLng].every((x) => Number.isFinite(x))
    ) {
        const layout = computeBoundsGridLayout(
            meta.southWestLat,
            meta.southWestLng,
            meta.northEastLat,
            meta.northEastLng,
        );
        return nearbyRadiusMetersForViewportGrid(layout);
    }
    return envInt('SEED_VIEWPORT_NEARBY_RADIUS_FALLBACK_METERS', 8000, 200, 50000);
}

async function runViewportPlacesRecrawl(regionKey, gridPoints, meta = {}) {
    const db = getDb();
    const SEARCHES = backgroundExpansionSearches();
    const maxPreview = Math.min(5000, parseInt(process.env.SEED_VIEWPORT_CANDIDATE_PREVIEW_MAX || '2000', 10) || 2000);
    const nearbyRadiusMeters = resolveViewportSeedRadiusMeters(meta);
    try {
        const allRaw = [];
        for (const point of gridPoints) {
            const raw = await fetchGooglePlaces(point.lat, point.lng, nearbyRadiusMeters, SEARCHES);
            allRaw.push(...raw);
        }
        const newPlaces = normalizeAndDedupe(allRaw, regionKey);
        const newToUpsert = await filterOutPlacesArchivedAfterMerge(db, newPlaces);
        let inserted = 0;
        if (newToUpsert.length > 0) {
            const bulkOps = newToUpsert.map((p) => ({
                updateOne: {
                    filter: { _id: p._id },
                    update: { $setOnInsert: p },
                    upsert: true,
                },
            }));
            const bgResult = await db.collection('playgrounds').bulkWrite(bulkOps);
            inserted = bgResult.upsertedCount || 0;
        }
        const candidatesPreview = newPlaces.slice(0, maxPreview).map(compactPlaceForViewportReview);
        const candidatesPreviewTruncated = newPlaces.length > candidatesPreview.length;
        const campusDiscovery = await discoverCampusSubvenues(regionKey, { db });
        let canonicalization = null;
        try {
            const { canonicalizeRegionVenues } = require('./venueMergeService');
            canonicalization = await canonicalizeRegionVenues(regionKey);
        } catch (mergeErr) {
            canonicalization = { errorMessage: mergeErr.message };
        }
        console.log(
            `[seed] Viewport map seed ${regionKey}: grid=${gridPoints.length} pts, radiusMeters=${nearbyRadiusMeters}, ${inserted} inserted, ${newPlaces.length} kid-filtered candidates`,
        );
        await db.collection('seeded_regions').updateOne(
            { regionKey },
            {
                $set: {
                    lastViewportSeedAt: new Date(),
                    lastViewportSeed: {
                        ...meta,
                        gridPointCount: gridPoints.length,
                        inserted,
                        kidFilteredCandidates: newPlaces.length,
                        afterArchiveFilterCount: newToUpsert.length,
                        candidatesPreview,
                        candidatesPreviewTruncated,
                        campusDiscovery,
                        canonicalization,
                    },
                },
            },
        );
    } catch (err) {
        console.error(`[seed] Viewport map seed failed for ${regionKey}:`, err.message);
        await db.collection('seeded_regions').updateOne(
            { regionKey },
            {
                $set: {
                    lastViewportSeedAt: new Date(),
                    lastViewportSeed: {
                        ...meta,
                        gridPointCount: gridPoints.length,
                        error: err.message,
                    },
                },
            },
        ).catch(() => {});
    }
}

/**
 * Validates bounds, builds grid, returns summary; runs crawl on next tick (heavy Google + DB work).
 * @param {object} [options] — `mode`: omit or 'rebuild' = Places grid; 'reconcile' = merge only (gated by env).
 * @throws {Error} code NOT_FOUND | BAD_BOUNDS | VIEWPORT_TOO_LARGE | FORBIDDEN_MODE
 */
async function scheduleViewportPlacesRecrawlForRegion(regionKey, bounds, userId, options = {}) {
  const mode = String(options.mode || bounds?.mode || 'rebuild').toLowerCase();
  if (mode === 'reconcile') {
    if (process.env.SEED_VIEWPORT_RECONCILE_ENABLED !== '1') {
      const err = new Error('Viewport reconcile is disabled. Set SEED_VIEWPORT_RECONCILE_ENABLED=1 on the server.');
      err.code = 'FORBIDDEN_MODE';
      throw err;
    }
    const region = await getDb().collection('seeded_regions').findOne({ regionKey });
    if (!region) {
      const err = new Error(`Region not found: ${regionKey}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    const meta = {
      mode: 'reconcile',
      requestedByUserId: userId ?? null,
    };
    setImmediate(() => {
      runViewportReconcileForRegion(regionKey, meta).catch((e) =>
        console.error(`[seed-viewport-reconcile] ${regionKey}:`, e.message),
      );
    });
    return { regionKey, gridPointCount: 0, mode: 'reconcile' };
  }

  if (mode === 'rebuild' && process.env.SEED_VIEWPORT_REBUILD_ENABLED === '0') {
    const err = new Error('Viewport rebuild (Places grid) is disabled. Set SEED_VIEWPORT_REBUILD_ENABLED=1 or omit mode.');
    err.code = 'FORBIDDEN_MODE';
    throw err;
  }

  const swLat = Number(bounds.southWestLat);
  const swLng = Number(bounds.southWestLng);
  const neLat = Number(bounds.northEastLat);
  const neLng = Number(bounds.northEastLng);
  if (![swLat, swLng, neLat, neLng].every((x) => Number.isFinite(x))) {
    const err = new Error('southWestLat, southWestLng, northEastLat, northEastLng must be finite numbers');
    err.code = 'BAD_BOUNDS';
    throw err;
  }

  const db = getDb();
  const requestedRegionKey = String(regionKey || '').trim();
  let resolvedRegionKey = requestedRegionKey;
  let region = await db.collection('seeded_regions').findOne({ regionKey: resolvedRegionKey });
  if (!region) {
    const centerLat = (swLat + neLat) / 2;
    const centerLng = (swLng + neLng) / 2;
    const nearest = await resolveNearestSeededRegionForMapViewport(db, centerLat, centerLng);
    if (nearest) {
      resolvedRegionKey = nearest.regionKey;
      region = await db.collection('seeded_regions').findOne({ regionKey: resolvedRegionKey });
    }
  }
  if (!region) {
    const err = new Error(`Region not found: ${regionKey}`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  const layout = computeBoundsGridLayout(swLat, swLng, neLat, neLng);
  const gridPoints = layout.points;
  const nearbyRadiusMeters = nearbyRadiusMetersForViewportGrid(layout);
  const meta = {
    southWestLat: swLat,
    southWestLng: swLng,
    northEastLat: neLat,
    northEastLng: neLng,
    requestedByUserId: userId ?? null,
    mode: 'rebuild',
    nearbyRadiusMeters,
    seedGridRows: layout.rows,
    seedGridCols: layout.cols,
    ...(requestedRegionKey !== resolvedRegionKey
      ? { requestedRegionKey, resolvedRegionKey }
      : {}),
  };
  setImmediate(() => {
    runViewportPlacesRecrawl(resolvedRegionKey, gridPoints, meta).catch((e) =>
      console.error(`[seed-viewport] ${resolvedRegionKey}:`, e.message),
    );
  });
  return {
    regionKey: resolvedRegionKey,
    gridPointCount: gridPoints.length,
    mode: 'rebuild',
    ...(requestedRegionKey !== resolvedRegionKey
      ? { requestedRegionKey, resolvedRegionKey }
      : {}),
  };
}

/**
 * Re-fetch Places for an already-seeded region when `seedAlgorithmVersion` is behind (no full scrub/merge).
 */
async function runLightweightAlgorithmRecrawl(regionKey, lat, lng) {
    const db = getDb();
    const SEARCHES = backgroundExpansionSearches();
    const region = await db.collection('seeded_regions').findOne(
        { regionKey },
        { projection: { viewport: 1 } },
    );
    const { points: gridPoints, nearbyRadiusMeters, source: gridSource } = buildBackgroundExpansionGrid(
        lat,
        lng,
        region && region.viewport,
    );
    try {
        const allRaw = [];
        for (const point of gridPoints) {
            const raw = await fetchGooglePlaces(point.lat, point.lng, nearbyRadiusMeters, SEARCHES);
            allRaw.push(...raw);
        }
        const newPlaces = normalizeAndDedupe(allRaw, regionKey);
        const newToUpsert = await filterOutPlacesArchivedAfterMerge(db, newPlaces);
        let inserted = 0;
        if (newToUpsert.length > 0) {
            const bulkOps = newToUpsert.map((p) => ({
                updateOne: {
                    filter: { _id: p._id },
                    update: { $setOnInsert: p },
                    upsert: true,
                },
            }));
            const bgResult = await db.collection('playgrounds').bulkWrite(bulkOps);
            inserted = bgResult.upsertedCount || 0;
        }
        const campusDiscovery = await discoverCampusSubvenues(regionKey, { db });
        let canonicalization = null;
        try {
            const { canonicalizeRegionVenues } = require('./venueMergeService');
            canonicalization = await canonicalizeRegionVenues(regionKey);
        } catch (mergeErr) {
            canonicalization = { errorMessage: mergeErr.message };
        }
        console.log(
            `[seed] Algorithm v${SEED_ALGORITHM_VERSION} lightweight recrawl ${regionKey} (${gridSource}, ${
                gridPoints.length
            } pts, r≈${nearbyRadiusMeters}m): ${inserted} inserted, ${
                campusDiscovery.candidatesInserted
            } campus subvenues inserted, ${newPlaces.length} kid-filtered candidates`,
        );
        await db.collection('seeded_regions').updateOne(
            { regionKey },
            {
                $set: {
                    seedAlgorithmVersion: SEED_ALGORITHM_VERSION,
                    algorithmRecrawlInFlight: false,
                    lastAlgorithmRecrawlAt: new Date(),
                    lastAlgorithmRecrawlCampusDiscovery: campusDiscovery,
                    lastAlgorithmRecrawlCanonicalization: canonicalization,
                },
            },
        );
    } catch (err) {
        console.error(`[seed] Lightweight algorithm recrawl failed for ${regionKey}:`, err.message);
        await db.collection('seeded_regions').updateOne(
            { regionKey },
            { $set: { algorithmRecrawlInFlight: false } },
        );
    }
}

/**
 * If this region was seeded under an older algorithm, run a one-off grid re-crawl (single-flight, stale lock 2h).
 */
async function enqueueStaleAlgorithmRecrawlIfNeeded(db, regionKey, existingRegion, fallbackLat, fallbackLng) {
    if (regionSeedAlgorithmVersion(existingRegion) >= SEED_ALGORITHM_VERSION) return;

    const center = seededRegionCenterToLatLng(existingRegion.center);
    const lat = center?.lat ?? fallbackLat;
    const lng = center?.lng ?? fallbackLng;
    if (lat == null || lng == null) return;

    const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const res = await db.collection('seeded_regions').updateOne(
        {
            regionKey,
            $and: [
                {
                    $or: [
                        { seedAlgorithmVersion: { $exists: false } },
                        { seedAlgorithmVersion: { $lt: SEED_ALGORITHM_VERSION } },
                    ],
                },
                {
                    $or: [
                        { algorithmRecrawlInFlight: { $ne: true } },
                        { algorithmRecrawlStartedAt: { $lt: staleBefore } },
                    ],
                },
            ],
        },
        { $set: { algorithmRecrawlInFlight: true, algorithmRecrawlStartedAt: new Date() } },
    );
    if (res.modifiedCount === 0) return;

    setImmediate(() => {
        runLightweightAlgorithmRecrawl(regionKey, lat, lng);
    });
}

/**
 * Infers a default costRange from Google place types and name.
 * Public parks / school playgrounds → "Free"
 * Indoor play places / amusement parks / private venues → "Unknown"
 * Everything else → null (let the UI show "Unknown" via display logic)
 */
function inferCostRange(types, name) {
    const typesLower = (types || []).map(t => t.toLowerCase());
    const nameLower = (name || '').toLowerCase();

    // Clearly free: public parks, nature areas, school grounds
    const freeTypes = ['park', 'natural_feature', 'campground'];
    const freeNameKeywords = ['elementary', 'school', 'public park', 'city park', 'county park', 'neighborhood park', 'community park'];
    const isFreeType = freeTypes.some(t => typesLower.includes(t));
    const isFreeByName = freeNameKeywords.some(kw => nameLower.includes(kw));

    // Likely paid: indoor play, amusement parks, museums, zoos, aquariums, arcades
    const paidTypes = ['amusement_park', 'museum', 'zoo', 'aquarium', 'arcade', 'amusement_arcade'];
    const paidNameKeywords = ['indoor', 'trampoline', 'bounce', 'play place', 'fun zone', 'adventure', 'discovery', 'science center', 'children\'s museum'];
    const isPaidType = paidTypes.some(t => typesLower.includes(t));
    const isPaidByName = paidNameKeywords.some(kw => nameLower.includes(kw));

    if (isPaidType || isPaidByName) return 'Unknown';
    if (isFreeType || isFreeByName) return 'Free';
    return null; // genuinely unknown — don't assume
}

/**
 * Fetches additional details for a Google Place (editorial summary, hours, website, phone).
 * Returns null on failure — callers should treat missing details as optional enrichment.
 */
async function fetchPlaceDetails(placeId) {
    const fields = [
        'name',
        'geometry',
        'type',
        'types',
        'address_component',
        'adr_address',
        'editorial_summary',
        'opening_hours',
        'website',
        'formatted_phone_number',
        'formatted_address',
        'business_status',
    ].join(',');
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;
    try {
        const response = await retryWithBackoff(
            () => axios.get(url),
            { maxRetries: 2, baseDelayMs: 1500, label: `place-details-${placeId.slice(-6)}` }
        );
        if (response.data.status !== 'OK') return null;
        return response.data.result || null;
    } catch (_) {
        return null;
    }
}

/**
 * Resolves Google Place ID for seeded docs (googlePlaceId or string _id like ChIJ…).
 * @param {Object} playground — raw Mongo document
 * @returns {string|null}
 */
function resolveGooglePlaceIdForDetails(playground) {
    if (playground.googlePlaceId && typeof playground.googlePlaceId === 'string') {
        return playground.googlePlaceId;
    }
    const id = playground._id;
    // Seeded venues use Google place_id as string _id; user submissions use 24-char ObjectId hex.
    if (typeof id === 'string' && id.length >= 12 && !/^[a-fA-F0-9]{24}$/.test(id)) {
        return id;
    }
    return null;
}

/**
 * Fetches Place Details when address or description is missing, returns fields to $set (persisted).
 * Used on GET playground by id so list/detail views fill in without waiting for batch enrichment.
 * @param {Object} playground — raw Mongo document
 * @returns {Promise<Object|null>} patch object or null
 */
async function hydratePlaygroundFromPlaceDetails(playground) {
    const placeId = resolveGooglePlaceIdForDetails(playground);
    if (!placeId) return null;

    const addr = playground.address != null ? String(playground.address).trim() : '';
    const needsAddress = addr.length === 0;
    const desc = playground.description != null ? String(playground.description).trim() : '';
    const needsDesc = desc.length < 15;

    const needsNorm =
        !playground.admin ||
        playground.admin.normalizationVersion !== LOCATION_NORMALIZATION_VERSION ||
        !playground.normalized ||
        !playground.normalized.cityDisplay;

    if (!needsAddress && !needsDesc && !needsNorm) return null;

    const details = await fetchPlaceDetails(placeId);
    if (!details) return null;

    const db = getDb();
    const patch = {};
    if (needsAddress && details.formatted_address) {
        patch.address = details.formatted_address;
    }
    const editorial = (details.editorial_summary && details.editorial_summary.overview)
        ? String(details.editorial_summary.overview).trim()
        : '';
    if (needsDesc && editorial.length >= 10) {
        patch.description = editorial;
    }
    if (details.website && !playground.website) patch.website = details.website;
    if (details.formatted_phone_number && !playground.phoneNumber) {
        patch.phoneNumber = details.formatted_phone_number;
    }
    if (details.opening_hours?.weekday_text?.length && !playground.hours) {
        patch.hours = details.opening_hours.weekday_text.join(' | ');
    }

    if (needsNorm) {
        const lat = playground.location?.coordinates?.[1];
        const lng = playground.location?.coordinates?.[0];
        const pack = await normalizePlaygroundFromGoogleDetails(
            db,
            placeId,
            details,
            { lat, lng },
            GOOGLE_MAPS_API_KEY,
        );
        patch.googleRaw = pack.googleRaw;
        patch.normalized = pack.normalized;
        patch.admin = { ...(playground.admin || {}), ...pack.admin };
        patch.primaryType = (details.types && details.types[0]) || playground.primaryType || null;
        if (!playground.source) patch.source = 'google_places';
        if (pack.normalized.cityDisplay) patch.city = pack.normalized.cityDisplay;
        if (pack.normalized.stateCode) patch.state = pack.normalized.stateCode;
        if (pack.normalized.postalCode) patch.zipCode = pack.normalized.postalCode;
    }

    return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Normalizes and deduplicates raw Google Places results.
 */
function normalizeAndDedupe(places, regionKey) {
    const uniquePlaces = new Map();

    places.forEach(p => {
        if (!isKidFriendlySeedCandidate(p)) {
            return;
        }

        if (!uniquePlaces.has(p.place_id)) {
            const playgroundType = inferPlaygroundType(p.types || [], p.name || '');

            uniquePlaces.set(p.place_id, {
                _id: p.place_id, // Use Google's ID as our primary key
                source: 'google_places',
                name: p.name,
                location: {
                    type: "Point",
                    coordinates: [p.geometry.location.lng, p.geometry.location.lat]
                },
                imageUrls: p.photos ? p.photos.slice(0, 5).map(photo => `google_photo:${photo.photo_reference}`) : [],
                googlePlaceId: p.place_id,
                primaryType: (p.types && p.types[0]) || null,
                googleRaw: {
                    formattedAddress: p.vicinity || p.formatted_address || null,
                    addressComponents: null,
                    regionCode: null,
                },
                normalized: null,
                admin: {
                    localitySource: null,
                    needsReview: true,
                    normalizationVersion: 0,
                },
                regionKey: regionKey,
                types: p.types,
                playgroundType: playgroundType,
                costRange: inferCostRange(p.types, p.name),
                verificationCount: 1,
                createdAt: new Date(),
                lastVerifiedAt: new Date(),
                lastVerifiedSource: 'seed',
                status: 'active',
                // 9.1 — initialize trust scores for all verifiable amenity fields
                trustScores: {
                    hasBathrooms: 0.5,
                    hasShade: 0.5,
                    isFenced: 0.5,
                    hasPicnicTables: 0.5,
                    hasWaterFountain: 0.5,
                    isToddlerFriendly: 0.5,
                    hasSplashPad: 0.5,
                    isDogFriendly: 0.5,
                    hasWalkingTrail: 0.5,
                    hasParking: 0.5,
                }
            });
        }
    });
    return Array.from(uniquePlaces.values());
}

/**
 * Merged venues are removed from `playgrounds` and copied to `archived_playgrounds` with the same _id.
 * Seed upserts use `_id` = Google place_id, so without this filter the next seed run resurrects them
 * as duplicate top-level rows (parent still lists them under subVenues).
 * Unlink restores a row by removing it from the archive — then it is eligible to upsert again.
 *
 * @param {import('mongodb').Db} db
 * @param {object[]} places
 * @returns {Promise<object[]>}
 */
async function filterOutPlacesArchivedAfterMerge(db, places) {
    if (!places || places.length === 0) return places;
    const ids = [...new Set(places.map((p) => p._id).filter((id) => id != null))];
    if (ids.length === 0) return places;
    const archived = await db
        .collection('archived_playgrounds')
        .find({ _id: { $in: ids } })
        .project({ _id: 1 })
        .toArray();
    if (archived.length === 0) return places;
    const skip = new Set(archived.map((a) => String(a._id)));
    const filtered = places.filter((p) => !skip.has(String(p._id)));
    if (filtered.length < places.length) {
        console.log(
            `[seed] Skipping ${places.length - filtered.length} place(s) present in archived_playgrounds (merged); not re-upserting.`,
        );
    }
    return filtered;
}

/**
 * Enriches seeded places with Google Place Details + Gemini descriptions.
 * Runs after places are inserted — best-effort, non-blocking per place.
 */
async function enrichPlacesWithDetails(regionKey) {
    const db = getDb();
    const googlePlaceClause = {
        $or: [
            { googlePlaceId: { $exists: true, $nin: [null, ''] } },
            {
                $and: [
                    { _id: { $type: 'string' } },
                    { _id: { $not: /^[a-fA-F0-9]{24}$/ } },
                ],
            },
        ],
    };

    const needsNormalization = {
        $or: [
            { 'admin.normalizationVersion': { $ne: LOCATION_NORMALIZATION_VERSION } },
            { admin: { $exists: false } },
            { 'normalized.cityDisplay': { $exists: false } },
            { normalized: null },
        ],
    };

    const needsDescAddr = {
        $or: [
            { description: { $exists: false } },
            { description: '' },
            { description: null },
            { address: { $exists: false } },
            { address: '' },
            { address: null },
        ],
    };

    let totalEnriched = 0;
    const BATCH_SIZE = 50;
    while (true) {
        const places = await db.collection('playgrounds').find({
            regionKey,
            ...ACTIVE_PLAYGROUND_FILTER,
            $and: [
                googlePlaceClause,
                { $or: [needsNormalization, needsDescAddr] },
            ],
        }).limit(BATCH_SIZE).toArray();

        if (places.length === 0) break;

        for (const place of places) {
            try {
                const pid = resolveGooglePlaceIdForDetails(place);
                if (!pid) continue;
                const details = await fetchPlaceDetails(pid);
                const update = {};

                const needsNorm =
                    !place.admin ||
                    place.admin.normalizationVersion !== LOCATION_NORMALIZATION_VERSION ||
                    !place.normalized ||
                    !place.normalized.cityDisplay;

                if (details && needsNorm) {
                    const lat = place.location?.coordinates?.[1];
                    const lng = place.location?.coordinates?.[0];
                    const pack = await normalizePlaygroundFromGoogleDetails(
                        db,
                        pid,
                        details,
                        { lat, lng },
                        GOOGLE_MAPS_API_KEY,
                    );
                    update.googleRaw = pack.googleRaw;
                    update.normalized = pack.normalized;
                    update.admin = { ...(place.admin || {}), ...pack.admin };
                    update.primaryType = (details.types && details.types[0]) || place.primaryType || null;
                    if (!place.source) update.source = 'google_places';
                    if (pack.normalized.cityDisplay) update.city = pack.normalized.cityDisplay;
                    if (pack.normalized.stateCode) update.state = pack.normalized.stateCode;
                    if (pack.normalized.postalCode) update.zipCode = pack.normalized.postalCode;
                }

                if (details) {
                    if (details.website) update.website = details.website;
                    if (details.formatted_phone_number) update.phoneNumber = details.formatted_phone_number;
                    if (details.formatted_address) update.address = details.formatted_address;
                    if (details.opening_hours?.weekday_text?.length) {
                        update.hours = details.opening_hours.weekday_text.join(' | ');
                    }
                }

                const editorialSummary = details?.editorial_summary?.overview || '';
                const skipGeminiDesc =
                    process.env.SKIP_GEMINI_DESCRIPTION === '1' ||
                    process.env.SKIP_GEMINI_DESCRIPTION === 'true';

                // Generate Gemini description if we don't have one from Google
                if (!editorialSummary || editorialSummary.length < 20) {
                    let heroBuffer = null;
                    if (!skipGeminiDesc) {
                        const heroUrl = place.imageUrls?.[0];
                        if (heroUrl && !heroUrl.startsWith('google_photo:')) {
                            try {
                                const r = await axios.get(heroUrl, { responseType: 'arraybuffer', timeout: 8000 });
                                heroBuffer = Buffer.from(r.data, 'binary');
                            } catch (_) {}
                        } else if (heroUrl?.startsWith('google_photo:')) {
                            try {
                                const ref = heroUrl.split(':')[1];
                                const photoApiUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${ref}&key=${GOOGLE_MAPS_API_KEY}`;
                                const r = await axios.get(photoApiUrl, { responseType: 'arraybuffer', timeout: 8000 });
                                heroBuffer = Buffer.from(r.data, 'binary');
                            } catch (_) {}
                        }
                    }

                    const generated = skipGeminiDesc
                        ? ''
                        : await getGeminiDescription(place.name, place.types || [], heroBuffer, editorialSummary);
                    if (generated) update.description = generated;
                } else {
                    update.description = editorialSummary;
                }

                if (Object.keys(update).length > 0) {
                    await db.collection('playgrounds').updateOne({ _id: place._id }, { $set: update });
                }
            } catch (err) {
                console.error(`[enrich] Failed for ${place.name}:`, err.message);
            }
            // Throttle between places to avoid rate limiting on Google Places + Gemini
            await new Promise(r => setTimeout(r, 300));
        }
        totalEnriched += places.length;
    }
    if (totalEnriched > 0) {
        console.log(`[enrich] Enriched ${totalEnriched} places for ${regionKey}`);
    }
}

/**
 * The main orchestrator for handling a new city search.
 */
async function handleHybridSearch(lat, lng, userId) {
    const db = getDb();
    const geoData = await geocodeLatLng(lat, lng);

    // Limit seeding to USA only
    if (geoData.country !== 'US') {
        throw new Error('Play Place Finder is currently available in the United States only.');
    }

    const nr = geoData.normalizedRegion;
    const regionKey =
        nr && nr.citySlug && String(nr.citySlug).length > 0
            ? nr.citySlug
            : normalizeRegionKey(geoData.city, geoData.state);

    const existingRegion = await db.collection('seeded_regions').findOne({ regionKey });
    if (existingRegion) {
        // Sort by distance even for cached results
        const places = await db.collection('playgrounds').find({
            regionKey,
            ...ACTIVE_PLAYGROUND_FILTER,
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [lng, lat] }
                }
            }
        }).limit(50).toArray();
        enqueueLightRefreshIfNeeded(db, existingRegion, {
            requestedBy: 'user_search',
            requestedByUserId: userId,
            force: regionSeedAlgorithmVersion(existingRegion) < SEED_ALGORITHM_VERSION,
        }).catch((err) =>
            console.error('[seed] enqueueLightRefreshIfNeeded:', err.message),
        );
        return { status: existingRegion.seedStatus, regionKey, places };
    }

    // Atomic lock: prevent concurrent seeds for the same region
    const lockResult = await db.collection('seeded_regions').findOneAndUpdate(
        { regionKey, seedStatus: { $nin: ['running', 'partial'] } },
        { $set: { seedStatus: 'running', seedStartedAt: new Date() } },
        { upsert: false, returnDocument: 'after' }
    );
    if (!lockResult) {
        // Another seed is already running — just return existing data
        console.log(`[seed] Skipping concurrent seed for ${regionKey} — already running`);
        const existingPlaces = await db.collection('playgrounds')
            .find({ regionKey, ...ACTIVE_PLAYGROUND_FILTER })
            .toArray();
        return { regionKey, places: existingPlaces, seeded: false };
    }

    const session = db.client.startSession();
    let fastResults = [];

    try {
        await session.withTransaction(async () => {
            await db.collection('seeded_regions').insertOne({
                regionKey,
                city: geoData.city,
                displayCity: geoData.city,
                state: geoData.state,
                country: geoData.country,
                citySlugNormalized: nr?.citySlug || regionKey,
                locationNormalizationVersion: LOCATION_NORMALIZATION_VERSION,
                center: { type: "Point", coordinates: [lng, lat] },
                viewport: geoData.viewport,
                seedStatus: 'running',
                seededAt: new Date(),
                seedAlgorithmVersion: SEED_ALGORITHM_VERSION,
            }, { session });

            await db.collection('seed_jobs').insertOne({
                regionKey,
                status: 'running',
                requestedByUserId: userId,
                startedAt: new Date()
            }, { session });

            // INLINE FAST SEED (valid types + kid keywords)
            const rawPlaces = await fetchGooglePlaces(lat, lng, 48280, FAST_SEED_SEARCHES); // ~30 miles
            fastResults = normalizeAndDedupe(rawPlaces, regionKey);
            const fastToUpsert = await filterOutPlacesArchivedAfterMerge(db, fastResults);

            if (fastToUpsert.length > 0) {
                // Idempotency: fast seed can run multiple times (or overlap with background expansion).
                // Use upsert-style bulkWrite to avoid duplicate _id (Google place_id) crashes.
                const bulkOps = fastToUpsert.map((p) => ({
                    updateOne: {
                        filter: { _id: p._id },
                        update: { $setOnInsert: p },
                        upsert: true
                    }
                }));
                const bulkResult = await db.collection('playgrounds').bulkWrite(bulkOps, { session });
                const actualInserted = bulkResult.upsertedCount || 0;
                console.log(`[fast-seed] ${regionKey}: ${actualInserted} of ${fastToUpsert.length} places inserted (rest already existed)`);

                await db.collection('seeded_regions').updateOne(
                    { regionKey },
                    { $set: { seedStatus: 'partial', placeCount: actualInserted } },
                    { session }
                );
            }
        });
    } finally {
        await session.endSession();
    }

    // Enqueue background job (don't await)
    enqueueBackgroundExpansion(regionKey, lat, lng, geoData.viewport);

    // Quick best-photo sort for fast seed results — non-blocking, best-effort
    // Scores only the first google_photo ref per place so the hero image is correct immediately.
    quickSortFastSeedPhotos(fastResults).catch(err =>
        console.error(`[seed] quickSortFastSeedPhotos failed for ${regionKey}:`, err.message)
    );

    // Kick off a quick enrichment pass (descriptions, hours, website) — non-blocking
    enrichPlacesWithDetails(regionKey).catch(err =>
        console.error(`[seed] enrichPlacesWithDetails (fast) failed for ${regionKey}:`, err.message)
    );

    return { status: 'partial', regionKey, places: fastResults, message: "Displaying initial results. We're mapping the rest of the city for you now!" };
}

/**
 * Fixed 3×3 grid of lat/lng points centered on (lat, lng), ~10 mi step (legacy fallback when no viewport).
 */
function buildGrid3x3(lat, lng) {
    const STEP_DEG_LAT = 10 / 69.0;
    const STEP_DEG_LNG = 10 / (69.0 * Math.cos((lat * Math.PI) / 180));
    const offsets = [-1, 0, 1];
    const points = [];
    for (const dy of offsets) {
        for (const dx of offsets) {
            points.push({ lat: lat + dy * STEP_DEG_LAT, lng: lng + dx * STEP_DEG_LNG });
        }
    }
    return points;
}

/**
 * @returns {{ points: {lat,lng}[], layout: object|null, nearbyRadiusMeters: number, source: string }}
 */
function buildBackgroundExpansionGrid(lat, lng, viewport) {
    const maxPoints = envInt('SEED_BACKGROUND_GRID_MAX_POINTS', 20, 6, 50);
    const b = extractBoundsFromViewport(viewport);
    if (!b) {
        return {
            points: buildGrid3x3(lat, lng),
            layout: null,
            nearbyRadiusMeters: 24140,
            source: '3x3_no_viewport',
        };
    }
    try {
        const layout = computeBoundsGridLayout(
            b.swLat,
            b.swLng,
            b.neLat,
            b.neLng,
            maxPoints,
            { allowLargeMetros: true },
        );
        const r = nearbyRadiusMetersForBackgroundGrid(layout);
        return {
            points: layout.points,
            layout,
            nearbyRadiusMeters: r,
            source: 'viewport_bounds',
        };
    } catch (e) {
        if (
            e &&
            (e.code === 'VIEWPORT_TOO_LARGE' ||
                e.code === 'METRO_VIEWPORT_TOO_LARGE' ||
                e.code === 'BAD_BOUNDS' ||
                /Could not fit viewport|Invalid viewport|too large/.test(e.message))
        ) {
            console.warn(`[seed] buildBackgroundExpansionGrid: ${e.code || e.message} — 3×3 fallback`);
        } else {
            throw e;
        }
        return {
            points: buildGrid3x3(lat, lng),
            layout: null,
            nearbyRadiusMeters: 24140,
            source: '3x3_fallback',
        };
    }
}

/**
 * Grid for seed discovery: when [options.viewport] (geocode / seeded_regions) is present, tile that
 * bounding box (up to maxPoints) instead of a single center-biased 3×3; otherwise 3×3.
 * @param {object} [options]
 * @param {object} [options.viewport]
 * @param {number} [options.maxPoints] — overrides [SEED_BOUNDS_GRID_MAX_POINTS] for this call (light refresh uses smaller)
 */
function generateSearchGrid(lat, lng, options) {
    const o = options && typeof options === 'object' ? options : null;
    const defaultMax = envInt('SEED_BOUNDS_GRID_MAX_POINTS', 20, 4, 50);
    const maxPoints =
        o && o.maxPoints != null ? Math.max(1, Math.min(50, o.maxPoints)) : defaultMax;
    if (o && o.viewport) {
        const b = extractBoundsFromViewport(o.viewport);
        if (b) {
            try {
                const layout = computeBoundsGridLayout(
                    b.swLat,
                    b.swLng,
                    b.neLat,
                    b.neLng,
                    maxPoints,
                    { allowLargeMetros: true },
                );
                return layout.points;
            } catch (e) {
                if (e && (e.code === 'VIEWPORT_TOO_LARGE' || e.code === 'METRO_VIEWPORT_TOO_LARGE' || e.code === 'BAD_BOUNDS')) {
                    // fall through to 3x3
                } else if (e && (e.message || '').includes('Could not fit')) {
                    // fall through
                } else {
                    throw e;
                }
            }
        }
    }
    return buildGrid3x3(lat, lng);
}

/**
 * Runs the full seeding process in the background.
 */
async function enqueueBackgroundExpansion(regionKey, lat, lng, viewport) {
    const db = getDb();
    try {
        const SEARCHES = backgroundExpansionSearches();
        const { points: gridPoints, nearbyRadiusMeters, source } = buildBackgroundExpansionGrid(
            lat,
            lng,
            viewport,
        );
        console.log(
            `[seed] Grid expansion for ${regionKey} (${source}, ${gridPoints.length} points × ${
                SEARCHES.length
            } searches, radiusMeters≈${nearbyRadiusMeters})`,
        );

        const allRaw = [];
        for (const point of gridPoints) {
            const raw = await fetchGooglePlaces(point.lat, point.lng, nearbyRadiusMeters, SEARCHES);
            allRaw.push(...raw);
        }

        const newPlaces = normalizeAndDedupe(allRaw, regionKey);
        const newToUpsert = await filterOutPlacesArchivedAfterMerge(db, newPlaces);
        console.log(`[seed] Grid expansion found ${newPlaces.length} unique candidates for ${regionKey}`);

        if (newToUpsert.length > 0) {
            const bulkOps = newToUpsert.map(p => ({
                updateOne: {
                    filter: { _id: p._id },
                    update: { $setOnInsert: p },
                    upsert: true
                }
            }));
            const bgResult = await db.collection('playgrounds').bulkWrite(bulkOps);
            var bgInserted = bgResult.upsertedCount || 0;
            console.log(`[seed] Background expansion: ${bgInserted} of ${newToUpsert.length} places inserted for ${regionKey}`);
        } else {
            var bgInserted = 0;
        }

        const campusDiscovery = await discoverCampusSubvenues(regionKey, { db });
        console.log(
            `[seed] Campus subvenue discovery: ${campusDiscovery.candidatesInserted} inserted from ${campusDiscovery.anchorsScanned} anchor(s) for ${regionKey}`,
        );
        
        // --- Scrub Locations ---
        console.log(`Starting background AI location scrubbing for ${regionKey}...`);
        await scrubPlaygroundLocations(regionKey);
        console.log(`Finished background AI location scrubbing for ${regionKey}.`);

        // --- Enrich with details + AI descriptions ---
        console.log(`Starting place detail enrichment for ${regionKey}...`);
        await enrichPlacesWithDetails(regionKey);
        console.log(`Finished place detail enrichment for ${regionKey}.`);

        // --- Scrub Photos ---
        console.log(`Starting background AI photo scrubbing for ${regionKey}...`);
        await scrubPlaygroundPhotos(regionKey);
        console.log(`Finished background AI photo scrubbing for ${regionKey}.`);

        // --- Merge Duplicates ---
        console.log(`Starting venue merge for ${regionKey}...`);
        let mergeResults = { dedup: null, grouping: null };
        try {
            const { canonicalizeRegionVenues } = require('./venueMergeService');
            const canonicalResult = await canonicalizeRegionVenues(regionKey);
            const dedupResult = canonicalResult.dedup || { merged: 0, archived: 0 };
            console.log(`[merge] Dedup: ${dedupResult.merged} clusters merged, ${dedupResult.archived} entries archived`);
            const groupResult = canonicalResult.grouping || {};
            const campus = groupResult.campusGrouped || 0;
            const addr = groupResult.grouped || 0;
            const park = groupResult.parkGrouped || 0;
            console.log(`[merge] Sub-venue grouping: ${campus + park + addr} parent(s) (${campus} campus, ${park} park, ${addr} address)`);
            mergeResults = canonicalResult;
        } catch (mergeErr) {
            console.error(`[merge] Venue merge failed for ${regionKey}:`, mergeErr.message);
        }
        console.log(`Finished venue merge for ${regionKey}.`);

        await db.collection('seeded_regions').updateOne(
            { regionKey },
            {
                $set: { seedStatus: 'complete', seedAlgorithmVersion: SEED_ALGORITHM_VERSION },
                $inc: { placeCount: bgInserted },
            },
        ); // placeCount: legacy field; admin list uses live aggregation
        await db.collection('seed_jobs').updateOne({ regionKey, status: 'running' }, {
            $set: {
                status: 'complete',
                completedAt: new Date(),
                campusDiscovery,
                mergeResults,
            }
        });

        // Record advertising readiness and notify admins (city opens when first advertiser signs up or admin opens ads)
        await recordCityAdvertisingSeeded(regionKey);

        try {
            const { appendRunLog } = require('./seedRunLogService');
            await appendRunLog(db, {
                regionKey,
                runType: 'background_expansion',
                status: 'complete',
                meta: {
                    gridSource: source,
                    gridPointCount: gridPoints.length,
                    nearbyRadiusMeters,
                    searchTupleCount: SEARCHES.length,
                    estimatedNearbySearchVariants: gridPoints.length * SEARCHES.length,
                    kidFilteredCandidates: newPlaces.length,
                    inserted: bgInserted,
                },
            });
        } catch (logErr) {
            console.warn(`[seed] appendRunLog background_expansion ${regionKey}:`, logErr.message);
        }

    } catch (error) {
        await db.collection('seeded_regions').updateOne({ regionKey }, { $set: { seedStatus: 'failed' } });
        await db.collection('seed_jobs').updateOne({ regionKey, status: 'running' }, { $set: { status: 'failed', errorMessage: error.message, completedAt: new Date() } });
        adminNotificationService.notify(`Seed job for ${regionKey} failed: ${error.message}`, 'seed_job_failed');
    }
}

/**
 * Uses rules + cache + Gemini to evaluate if locations are play places; archives invalid ones.
 */
async function scrubPlaygroundLocations(regionKey) {
    const db = getDb();
    const playgrounds = await db.collection('playgrounds').find({ regionKey }).toArray();

    if (playgrounds.length === 0) return;

    const placesToEvaluate = playgrounds.map((p) => ({
        id: p._id,
        name: p.name,
        types: p.types,
    }));

    const chunkSize = 50;
    for (let i = 0; i < placesToEvaluate.length; i += chunkSize) {
        const chunk = placesToEvaluate.slice(i, i + chunkSize);
        const ids = chunk.map((p) => String(p.id));
        const cachedMap = await getManyCached(db, ids);

        const validationResult = {};
        const needLlm = [];

        for (const p of chunk) {
            const id = String(p.id);
            const hit = cachedMap.get(id);
            if (hit) {
                validationResult[id] = hit.valid;
                continue;
            }
            const { decision } = classifyPlaceForValidation({ id, name: p.name, types: p.types || [] });
            if (decision === 'accept') {
                validationResult[id] = true;
                await setCached(db, id, true, 'rule');
            } else if (decision === 'reject') {
                validationResult[id] = false;
                await setCached(db, id, false, 'rule');
            } else {
                needLlm.push(p);
            }
        }

        if (needLlm.length > 0) {
            const llmResult = await getGeminiLocationValidation(needLlm);
            for (const p of needLlm) {
                const id = String(p.id);
                let v = llmResult[id];
                if (v === undefined && p.id != null && llmResult[p.id] !== undefined) {
                    v = llmResult[p.id];
                }
                if (typeof v !== 'boolean') {
                    v = true;
                }
                validationResult[id] = v;
                await setCached(db, id, v, 'gemini');
            }
        }

        const idsToSoftDelete = [];
        for (const [id, isValid] of Object.entries(validationResult)) {
            if (isValid === false) {
                const badPlace = chunk.find((p) => String(p.id) === id);
                if (badPlace && isKidFriendlySeedCandidate(badPlace)) {
                    console.log(`AI scrubbed non-play location, but kept due to kid filter: ${badPlace.name}`);
                    continue;
                }
                idsToSoftDelete.push(badPlace ? badPlace.id : id);
                console.log(`AI scrubbed non-play location: ${badPlace ? badPlace.name : id}`);
            }
        }

        if (idsToSoftDelete.length > 0) {
            await db.collection('playgrounds').updateMany(
                { _id: { $in: idsToSoftDelete } },
                { $set: { archivedAt: new Date(), scrubReason: 'AI location validation failed' } },
            );
        }
    }
}

/**
 * Quick best-photo sort for fast seed results.
 * Scores only the first google_photo ref per place with Gemini so the hero image
 * is the best one immediately — before the full background scrub runs.
 * Processes at most MAX_QUICK_PHOTOS places to keep latency low.
 */
async function quickSortFastSeedPhotos(places) {
    const db = getDb();
    const maxPlaces = parseInt(process.env.QUICK_SORT_MAX_PLACES || "8", 10);
    const placesToScore = places
        .filter(p => p.imageUrls && p.imageUrls.length > 1)
        .slice(0, maxPlaces);

    for (const place of placesToScore) {
        const googleRefs = place.imageUrls.filter(u => u.startsWith('google_photo:'));
        if (googleRefs.length < 2) continue;

        const scored = [];
        for (const url of googleRefs.slice(0, 3)) { // score up to 3 per place
            const photoRef = url.split(':')[1];
            try {
                const googlePhotoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
                const response = await axios.get(googlePhotoUrl, { responseType: 'arraybuffer', maxRedirects: 5 });
                const imageBuffer = Buffer.from(response.data, 'binary');
                const resolvedUrl = response.request?.res?.responseUrl || googlePhotoUrl;
                const summary = await getGeminiSummary(imageBuffer, 0, place.types || [], place.name || "");
                if (summary && !summary.aiFailed && summary.photoUseful && summary.playgroundVisible) {
                    scored.push({
                        url,
                        resolvedUrl,
                        score: (summary.relevanceScore || 0) * 0.6 + (summary.overviewScore || 0) * 0.4
                    });
                }
            } catch (_) {
                // best-effort — skip on error
            }
        }

        if (scored.length === 0) continue;
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        const bestUrl = best.url;
        if (bestUrl === googleRefs[0]) continue; // already first

        // Replace google_photo: refs with resolved URLs where available
        const resolvedMap = Object.fromEntries(scored.map(s => [s.url, s.resolvedUrl]));
        const reordered = [bestUrl, ...place.imageUrls.filter(u => u !== bestUrl)]
            .map(u => resolvedMap[u] || u);
        await db.collection('playgrounds').updateOne(
            { _id: place._id },
            { $set: { imageUrls: reordered } }
        );
    }
}

/** Google Places photo reference from a gallery source URL (seed ref or resolved photo URL). */
function googlePhotoRefFromSourceUrl(orig) {
    if (!orig || typeof orig !== 'string') return null;
    if (orig.startsWith('google_photo:')) return orig.slice('google_photo:'.length);
    const m = orig.match(/photoreference=([^&]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
}

/** Collapse duplicate refs in a stored gallery (e.g. legacy scrub prepended raw + masked). */
function dedupeImageUrlListPreferMasked(urls) {
    if (!Array.isArray(urls) || urls.length < 2) return urls;
    const out = [];
    const refToIndex = new Map();
    for (const u of urls) {
        const ref = googlePhotoRefFromSourceUrl(u);
        const masked = typeof u === 'string' && u.includes('masked-photos');
        if (ref == null) {
            out.push(u);
            continue;
        }
        if (!refToIndex.has(ref)) {
            refToIndex.set(ref, out.length);
            out.push(u);
            continue;
        }
        const j = refToIndex.get(ref);
        const prevU = out[j];
        const prevMasked = typeof prevU === 'string' && prevU.includes('masked-photos');
        if (masked && !prevMasked) {
            out[j] = u;
        }
    }
    return out;
}

/**
 * Merges rows that share the same Places photo ref. Prefers masked (sticker) URLs so we never
 * keep both a privacy-masked copy and the raw Google URL for the same image.
 * @returns {{ u: string, ph: Object }[]}
 */
function dedupeAlignedGalleryPairs(finalUrls, usefulPhotos) {
    const pairs = [];
    const refToIndex = new Map();
    for (let i = 0; i < finalUrls.length; i++) {
        const u = finalUrls[i];
        const ph = usefulPhotos[i];
        const ref = googlePhotoRefFromSourceUrl(ph?.url);
        const masked = typeof u === 'string' && u.includes('masked-photos');
        if (ref == null) {
            pairs.push({ u, ph });
            continue;
        }
        if (!refToIndex.has(ref)) {
            refToIndex.set(ref, pairs.length);
            pairs.push({ u, ph });
            continue;
        }
        const j = refToIndex.get(ref);
        const prevU = pairs[j].u;
        const prevMasked = typeof prevU === 'string' && prevU.includes('masked-photos');
        if (masked && !prevMasked) {
            pairs[j] = { u, ph };
        }
    }
    return pairs;
}

/**
 * Iterates over all playgrounds in a region and scrubs their photos using Gemini.
 * - Picks the single best "top" photo (highest relevance + overview score)
 * - Stickers faces on all non-top photos that pass moderation
 * - Queues the top photo for seed review only when: face masking failed, the model requests review,
 *   combined relevance/overview is very low, or any of relevance / overview / confidence is below
 *   SEED_REVIEW_QUALITY_MIN (default 0.7). Strong all-green scores skip the queue.
 * - Auto-approves clean non-top photos when masking succeeds (no queue unless masking failed)
 */
async function scrubPlaygroundPhotos(regionKey) {
    const db = getDb();
    const playgrounds = await db.collection('playgrounds').find({ regionKey }).toArray();

    for (const place of playgrounds) {
        if (!place.imageUrls || place.imageUrls.length === 0) continue;

        const maxGooglePhotos = parseInt(process.env.SCRUB_MAX_GOOGLE_PHOTOS_PER_PLACE || "5", 10);
        let processedCount = 0;

        // Phase 1: Score all photos with Gemini
        const scoredPhotos = []; // { url, imageBuffer, geminiSummary, faces }

        for (const url of place.imageUrls) {
            if (!url.startsWith('google_photo:')) {
                scoredPhotos.push({ url, imageBuffer: null, geminiSummary: null, faces: [] });
                continue;
            }
            if (processedCount >= maxGooglePhotos) {
                scoredPhotos.push({ url, imageBuffer: null, geminiSummary: null, faces: [], skipped: true });
                continue;
            }

            const photoRef = url.split(':')[1];
            try {
                const googlePhotoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photoreference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
                const response = await axios.get(googlePhotoUrl, { responseType: 'arraybuffer', maxRedirects: 5 });
                const imageBuffer = Buffer.from(response.data, 'binary');
                // Capture the final resolved URL (after redirects) so we store a real HTTPS URL
                const resolvedUrl = response.request?.res?.responseUrl || response.config?.url || googlePhotoUrl;

                let faces = [];
                try { faces = await detectFaces(imageBuffer); } catch (_) {}

                const geminiSummary = await getGeminiSummary(imageBuffer, faces.length, place.types || [], place.name || "");
                processedCount++;

                scoredPhotos.push({ url, resolvedUrl, imageBuffer, geminiSummary, faces });
            } catch (err) {
                console.error(`Error processing photo for ${place.name}:`, err.message);
                scoredPhotos.push({ url, imageBuffer: null, geminiSummary: null, faces: [], error: true });
            }
        }

        // Phase 2: Filter to useful photos only
        const usefulPhotos = scoredPhotos.filter(p =>
            p.skipped || p.error || !p.geminiSummary ||
            (p.geminiSummary.photoUseful && p.geminiSummary.playgroundVisible)
        );

        if (usefulPhotos.length === 0) {
            // All photos scrubbed — keep originals to avoid empty gallery
            continue;
        }

        // Phase 3: Pick the top photo (best relevance + overview score, no faces preferred)
        const scored = usefulPhotos
            .filter(p => p.geminiSummary)
            .map(p => ({
                ...p,
                score: (p.geminiSummary.relevanceScore || 0) * 0.6 +
                       (p.geminiSummary.overviewScore || 0) * 0.4 -
                       (p.faces.length > 0 ? 0.1 : 0) // slight penalty for faces
            }))
            .sort((a, b) => b.score - a.score);

        const topPhoto = scored[0] || usefulPhotos[0];
        const topUrl = topPhoto.url;

        // Phase 4: Process each photo
        const finalUrls = [];
        const seedReviewItems = [];

        let hasGoodTopPhoto = !!topPhoto?.geminiSummary;

        for (const photo of usefulPhotos) {
            const isTop = photo.url === topUrl;

            if (!photo.imageBuffer || !photo.geminiSummary) {
                // Skipped/errored — use resolved URL if available, otherwise keep original
                finalUrls.push(photo.resolvedUrl && photo.resolvedUrl.startsWith('http') ? photo.resolvedUrl : photo.url);
                continue;
            }

            // Use the resolved HTTPS URL for storage; fall back to the Places API redirect URL
            const displayUrl = photo.resolvedUrl && photo.resolvedUrl.startsWith('http')
                ? photo.resolvedUrl
                : photo.url;

            const hasFaces = photo.faces.length > 0;

            // Try to mask faces — all photos with faces get stickers automatically
            let finalUrl = displayUrl;
            let maskingFailed = false;
            if (hasFaces) {
                try {
                    const masked = await applyStickerMasks(photo.imageBuffer, photo.faces);
                    finalUrl = await uploadBufferToPublic(masked, 'masked-photos');
                } catch (maskErr) {
                    console.error(`[scrub] Face masking/upload failed for ${place.name}:`, maskErr.message);
                    maskingFailed = true; // faces exposed — must queue for review
                }
            }

            finalUrls.push(finalUrl);

            // Score the photo and store in photo_scores
            if (photo.geminiSummary) {
                const photoScore = computePhotoScore(photo.geminiSummary, {
                    hasFaces: hasFaces,
                    isMasked: hasFaces && !maskingFailed,
                });
                await db.collection('photo_scores').updateOne(
                    { playgroundId: place._id, photoUrl: finalUrl },
                    { $set: {
                        score: photoScore,
                        geminiSummary: photo.geminiSummary,
                        detectedFeatures: photo.geminiSummary.detectedFeatures || null,
                        source: 'seed',
                        hasFaces,
                        isMasked: hasFaces && !maskingFailed,
                        scoredAt: new Date(),
                    }},
                    { upsert: true },
                );
            }

            // Queue for admin review if:
            // 1. Face masking failed (possible visible faces in stored image), or
            // 2. Top (hero) photo: model wants human, very weak scene match, or any core score below threshold.
            const gs = photo.geminiSummary;
            const combinedVisual =
                (gs.relevanceScore || 0) * 0.6 + (gs.overviewScore || 0) * 0.4;
            const qualityMin = geminiSummaryQualityMin(gs);
            const scoreThreshold = parseSeedReviewQualityMin();
            const action = String(gs.recommendedAction || '');
            const topNeedsHuman =
                isTop &&
                (action === 'NEEDS_ADMIN_REVIEW' ||
                    action === 'REJECT' ||
                    combinedVisual < 0.42 ||
                    qualityMin < scoreThreshold);
            if (maskingFailed || topNeedsHuman) {
                const queueReasons = buildSeedReviewQueueReasons({
                    maskingFailed,
                    topNeedsHuman,
                    gs,
                    combinedVisual,
                    qualityMin,
                    scoreThreshold,
                });
                seedReviewItems.push({
                    playgroundId: place._id,
                    playgroundName: place.name,
                    regionKey,
                    photoUrl: finalUrl,
                    isTopPhoto: isTop,
                    hasFaces,
                    maskingFailed,
                    queueReasons,
                    geminiSummary: photo.geminiSummary,
                    status: 'PENDING_SEED_REVIEW',
                    createdAt: new Date(),
                });
            }
        }

        // If no useful photos survived at all, queue a notice so admin knows the gallery is empty
        if (finalUrls.filter(u => u && !u.startsWith('google_photo:')).length === 0 && usefulPhotos.length === 0) {
            seedReviewItems.push({
                playgroundId: place._id,
                playgroundName: place.name,
                regionKey,
                photoUrl: null,
                isTopPhoto: false,
                noPhotosAvailable: true,
                queueReasons: ['No processed photos: Google gallery did not yield usable masked URLs for this place after scrub.'],
                status: 'PENDING_SEED_REVIEW',
                createdAt: new Date(),
            });
        }

        // Insert seed review items
        if (seedReviewItems.length > 0) {
            await db.collection('seed_review_queue').insertMany(seedReviewItems);
        }

        // Dedupe same Google photo ref (keep stickered copy only). Do NOT prepend a separate
        // "topDisplayUrl" — that duplicated the hero as raw Google URL + masked URL in the gallery.
        const pairs = dedupeAlignedGalleryPairs(finalUrls, usefulPhotos);
        const topIdx = pairs.findIndex((p) => p.ph && p.ph.url === topUrl);
        const topFirst =
            topIdx >= 0
                ? [pairs[topIdx].u, ...pairs.filter((_, i) => i !== topIdx).map((p) => p.u)]
                : pairs.map((p) => p.u);
        if (topFirst.join("||") !== place.imageUrls.join("||")) {
            await db.collection('playgrounds').updateOne(
                { _id: place._id },
                { $set: { imageUrls: topFirst } }
            );
        }

        // Merge AI-detected features from all photos into the playground record
        const allDetected = usefulPhotos
            .filter(p => p.geminiSummary?.detectedFeatures)
            .map(p => p.geminiSummary.detectedFeatures);
        if (allDetected.length > 0) {
            const mergedUpdate = {};
            // Equipment — union of all detected items
            const detectedEquipment = [...new Set(allDetected.flatMap(d => d.equipment || []))];
            if (detectedEquipment.length > 0) {
                mergedUpdate.equipment = [...new Set([...(place.equipment || []), ...detectedEquipment])];
            }
            // Swing types
            const detectedSwings = [...new Set(allDetected.flatMap(d => d.swingTypes || []))];
            if (detectedSwings.length > 0) {
                mergedUpdate.swingTypes = [...new Set([...(place.swingTypes || []), ...detectedSwings])];
            }
            // Sports courts
            const detectedSports = [...new Set(allDetected.flatMap(d => d.sportsCourts || []))];
            if (detectedSports.length > 0) {
                mergedUpdate.sportsCourts = [...new Set([...(place.sportsCourts || []), ...detectedSports])];
            }
            // Ground surface — SKIPPED from AI merge.
            // Gemini frequently misidentifies ground type (grass vs rubber/mulch under equipment).
            // Ground type is left as user-editable only.

            // Boolean amenities — only set to true, never override existing true values
            const amenityMap = {
                'Bathrooms': 'hasBathrooms', 'Shade': 'hasShade', 'Fenced': 'isFenced',
                'Picnic Tables': 'hasPicnicTables', 'Water Fountain': 'hasWaterFountain',
                'Benches': 'hasBenches', 'Trash Cans': 'hasTrashCans', 'Parking': 'hasParking',
                'Walking Trail': 'hasWalkingTrail', 'Splash Pad': 'hasSplashPad',
            };
            const detectedAmenities = [...new Set(allDetected.flatMap(d => d.amenities || []))];
            for (const amenity of detectedAmenities) {
                const field = amenityMap[amenity];
                if (field && place[field] !== true) {
                    mergedUpdate[field] = true;
                }
            }
            if (Object.keys(mergedUpdate).length > 0) {
                await db.collection('playgrounds').updateOne(
                    { _id: place._id },
                    { $set: mergedUpdate }
                );
                console.log(`[scrub] Merged AI-detected features for ${place.name}: ${Object.keys(mergedUpdate).join(', ')}`);
            }

            // Run equipment validation against the (now-merged) playground record
            // Coerce groundSurface to a plain string before passing to validate()
            const rawGround = allDetected.find(d => d.groundSurface)?.groundSurface || null;
            const safeGround = Array.isArray(rawGround) ? rawGround[0] : rawGround;
            const aggregatedDetections = {
                equipment: [...new Set(allDetected.flatMap(d => d.equipment || []))],
                swingTypes: [...new Set(allDetected.flatMap(d => d.swingTypes || []))],
                sportsCourts: [...new Set(allDetected.flatMap(d => d.sportsCourts || []))],
                amenities: [...new Set(allDetected.flatMap(d => d.amenities || []))],
                groundSurface: (typeof safeGround === 'string') ? safeGround : null,
            };
            const updatedPlace = await db.collection('playgrounds').findOne({ _id: place._id });
            const validationReport = validate(aggregatedDetections, updatedPlace, allDetected.length);

            await db.collection('playgrounds').updateOne(
                { _id: place._id },
                { $set: { photoValidation: validationReport } },
            );

            if (shouldQueueForReview(validationReport)) {
                await db.collection('seed_review_queue').insertOne({
                    playgroundId: place._id,
                    playgroundName: place.name,
                    regionKey,
                    status: 'EQUIPMENT_MISMATCH',
                    queueReasons: [
                        'Equipment / amenities from photos do not align with playground fields (EQUIPMENT_MISMATCH). See photoValidation on this item.',
                    ],
                    photoValidation: validationReport,
                    createdAt: new Date(),
                });
                console.log(`[scrub] Queued EQUIPMENT_MISMATCH review for ${place.name} (score: ${validationReport.dataQualityScore})`);
            }
        }

        // Re-rank gallery by quality score
        await rerankGallery(place._id);
    }
}

/**
 * Creates a lightweight city advertising status row and notifies admins after map seed completes.
 * Opening the city to paid placements still happens via first-advertiser bootstrap or admin “open advertising”.
 */
async function recordCityAdvertisingSeeded(regionKey) {
    const db = getDb();
    const region = await db.collection('seeded_regions').findOne({ regionKey });

    await db.collection('city_advertising_status').insertOne({
        regionKey,
        city: region.city,
        state: region.state,
        mapSeedCompleteAt: new Date(),
    });

    // Count pending seed review items for this region
    const seedReviewCount = await db.collection('seed_review_queue').countDocuments({
        regionKey,
        status: 'PENDING_SEED_REVIEW'
    });

    const reviewNote = seedReviewCount > 0
        ? ` ${seedReviewCount} photo(s) are waiting in the Seed Photo Review queue.`
        : '';

    const message = `New city seeded: ${region.city}, ${region.state}. Map data is ready; advertising opens when the first advertiser completes signup or you use Open advertising in admin.${reviewNote}`;
    adminNotificationService.notify(message, 'advertising_city_map_ready', regionKey);
}

/**
 * Validates `seeded_regions` and schedules runLightweightAlgorithmRecrawl (non-blocking).
 * @param {string} regionKey
 * @throws {Error} with `.code` 'NOT_FOUND' | 'BAD_CENTER'
 */
async function scheduleLightweightAlgorithmRecrawlForRegion(regionKey) {
    const db = getDb();
    const region = await db.collection('seeded_regions').findOne({ regionKey });
    if (!region) {
        const err = new Error(`Region not found: ${regionKey}`);
        err.code = 'NOT_FOUND';
        throw err;
    }
    const center = seededRegionCenterToLatLng(region.center);
    if (center == null) {
        const err = new Error(`Region ${regionKey} has no usable center coordinates`);
        err.code = 'BAD_CENTER';
        throw err;
    }
    setImmediate(() => {
        runLightweightAlgorithmRecrawl(regionKey, center.lat, center.lng).catch((e) =>
            console.error(`[lightweight-reseed] ${regionKey}:`, e.message),
        );
    });
}

/** Matches POST /admin/expand-region default — ~15 mi search radius per grid point. */
const ADMIN_EXPAND_RADIUS_METERS = 24140;

/**
 * Admin hub "Re-seed": wipe region-scoped collections + `seeded_regions` row, then start a fresh hybrid seed
 * from the stored center (same footprint as POST /admin/reseed-region when coords come from DB).
 * Returns after DB wipe; `handleHybridSearch` runs on next tick (running → partial → complete via background job).
 */
async function startFullRegionReseed(regionKey, userId) {
    const db = getDb();
    const region = await db.collection('seeded_regions').findOne({ regionKey });
    if (!region) {
        const err = new Error(`Region not found: ${regionKey}`);
        err.code = 'NOT_FOUND';
        throw err;
    }
    const center = seededRegionCenterToLatLng(region.center);
    if (!center) {
        const err = new Error(`Region ${regionKey} has no usable center coordinates`);
        err.code = 'BAD_CENTER';
        throw err;
    }
    const wipeCollections = ['playgrounds', 'seed_review_queue', 'seed_jobs', 'city_advertising_status'];
    for (const col of wipeCollections) {
        await db.collection(col).deleteMany({ regionKey });
    }
    await db.collection('seeded_regions').deleteOne({ regionKey });

    setImmediate(() => {
        handleHybridSearch(center.lat, center.lng, userId ?? null).catch((e) =>
            console.error(`[admin-full-reseed] handleHybridSearch ${regionKey}:`, e.message),
        );
    });
}

/**
 * After admin "Expand" bumps `coverageRadiusMiles`, run additive Places grid + mark `seedStatus` complete/failed.
 */
async function completeAdminExpandRegion(regionKey, userId) {
    const db = getDb();
    try {
        await expandRegion(regionKey, ADMIN_EXPAND_RADIUS_METERS, userId);
        await db.collection('seeded_regions').updateOne(
            { regionKey },
            { $set: { seedStatus: 'complete', seedAlgorithmVersion: SEED_ALGORITHM_VERSION } },
        );
    } catch (err) {
        console.error(`[admin-expand] ${regionKey}:`, err.message);
        await db.collection('seeded_regions').updateOne(
            { regionKey },
            { $set: { seedStatus: 'failed' } },
        ).catch(() => {});
        throw err;
    }
}

module.exports = {
    handleHybridSearch,
    expandRegion,
    trimPhotoGalleries,
    geocodeTextQuery,
    geocodeLatLng,
    normalizeRegionKey,
    hydratePlaygroundFromPlaceDetails,
    fetchPlaceDetails,
    resolveGooglePlaceIdForDetails,
    fetchGooglePlaces,
    normalizeAndDedupe,
    discoverCampusSubvenues,
    filterOutPlacesArchivedAfterMerge,
    generateSearchGrid,
    buildBackgroundExpansionGrid,
    extractBoundsFromViewport,
    SEED_ALGORITHM_VERSION,
    scheduleLightweightAlgorithmRecrawlForRegion,
    scheduleViewportPlacesRecrawlForRegion,
    generateSearchGridForBounds,
    startFullRegionReseed,
    completeAdminExpandRegion,
    ADMIN_EXPAND_RADIUS_METERS,
    seededRegionCenterToLatLng,
};

/**
 * Additively expands an existing region by fetching places at a larger radius.
 * Uses a 3×3 grid for maximum coverage. Does NOT wipe existing data.
 */
async function expandRegion(regionKey, radiusMeters, userId) {
    const db = getDb();

    const region = await db.collection('seeded_regions').findOne({ regionKey });
    if (!region) throw new Error(`Region "${regionKey}" not found in seeded_regions`);

    const center = seededRegionCenterToLatLng(region.center);
    if (!center) throw new Error(`Region "${regionKey}" has no usable center coordinates`);
    const { lat, lng } = center;

    const SEARCHES = backgroundExpansionSearches();

    const { points: gridPoints } = buildBackgroundExpansionGrid(lat, lng, region.viewport);
    const allRaw = [];
    for (const point of gridPoints) {
        const raw = await fetchGooglePlaces(point.lat, point.lng, radiusMeters, SEARCHES);
        allRaw.push(...raw);
    }

    const candidates = normalizeAndDedupe(allRaw, regionKey);
    if (candidates.length === 0) {
        const campusDiscovery = await discoverCampusSubvenues(regionKey, { db });
        let canonicalization = null;
        if (campusDiscovery.candidatesInserted > 0) {
            try {
                const { canonicalizeRegionVenues } = require('./venueMergeService');
                canonicalization = await canonicalizeRegionVenues(regionKey);
            } catch (mergeErr) {
                canonicalization = { errorMessage: mergeErr.message };
            }
        }
        return { regionKey, inserted: 0, scanned: 0, campusDiscovery, canonicalization };
    }

    const toUpsert = await filterOutPlacesArchivedAfterMerge(db, candidates);
    if (toUpsert.length === 0) {
        const campusDiscovery = await discoverCampusSubvenues(regionKey, { db });
        let canonicalization = null;
        if (campusDiscovery.candidatesInserted > 0) {
            try {
                const { canonicalizeRegionVenues } = require('./venueMergeService');
                canonicalization = await canonicalizeRegionVenues(regionKey);
            } catch (mergeErr) {
                canonicalization = { errorMessage: mergeErr.message };
            }
        }
        return { regionKey, inserted: 0, scanned: candidates.length, campusDiscovery, canonicalization };
    }

    const bulkOps = toUpsert.map(p => ({
        updateOne: {
            filter: { _id: p._id },
            update: { $setOnInsert: p },
            upsert: true
        }
    }));
    const result = await db.collection('playgrounds').bulkWrite(bulkOps);
    const inserted = result.upsertedCount || 0;
    const campusDiscovery = await discoverCampusSubvenues(regionKey, { db });
    let canonicalization = null;
    try {
        const { canonicalizeRegionVenues } = require('./venueMergeService');
        canonicalization = await canonicalizeRegionVenues(regionKey);
    } catch (mergeErr) {
        canonicalization = { errorMessage: mergeErr.message };
    }

    if (inserted > 0 || campusDiscovery.candidatesInserted > 0) {
        scrubPlaygroundLocations(regionKey).catch(err =>
            console.error(`[expand] scrubPlaygroundLocations failed for ${regionKey}:`, err.message)
        );
        enrichPlacesWithDetails(regionKey).catch(err =>
            console.error(`[expand] enrichPlacesWithDetails failed for ${regionKey}:`, err.message)
        );
    }

    return { regionKey, inserted, scanned: candidates.length, campusDiscovery, canonicalization };
}

/**
 * Trims photo galleries: first deduplicates near-identical photos,
 * then trims to maxPhotos using stored scores from photo_scores.
 * Falls back to Gemini scoring only for photos without a stored score.
 *
 * @param {object} options
 * @param {string} [options.regionKey]  - limit to one region, or omit for all
 * @param {number} [options.maxPhotos]  - max photos to keep per playground (default 25)
 * @param {boolean} [options.dryRun]    - if true, log what would be trimmed but don't write
 */
async function trimPhotoGalleries({ regionKey, maxPhotos = 25, dryRun = false } = {}) {
    const db = getDb();
    const filter = { archivedAt: { $exists: false } };
    if (regionKey) filter.regionKey = regionKey;

    const playgrounds = await db.collection('playgrounds').find(filter).toArray();

    console.log(`[trim] Found ${playgrounds.length} playgrounds to check${regionKey ? ` in ${regionKey}` : ''}`);

    let totalTrimmed = 0;
    let totalDeduped = 0;

    for (const place of playgrounds) {
        const urls = place.imageUrls || [];
        if (urls.length < 2) continue;

        // Step 0: Same Places photo ref twice (masked + raw API URL) — keep stickered copy
        const refDeduped = dedupeImageUrlListPreferMasked(urls);
        if (!dryRun && refDeduped.length < urls.length) {
            await db.collection('playgrounds').updateOne(
                { _id: place._id },
                { $set: { imageUrls: refDeduped } },
            );
            totalDeduped += urls.length - refDeduped.length;
            console.log(
                `[trim] ${place.name}: removed ${urls.length - refDeduped.length} duplicate ref(s) (prefer masked)`,
            );
        }

        // Step 1: Deduplicate near-identical photos
        if (!dryRun) {
            const dedupResult = await deduplicateGallery(place._id);
            totalDeduped += dedupResult.removed;
            if (dedupResult.removed > 0) {
                console.log(`[trim] ${place.name}: deduped ${dedupResult.removed} near-duplicate photos`);
            }
        }

        // Re-read after dedup (imageUrls may have changed)
        const refreshed = await db.collection('playgrounds').findOne({ _id: place._id });
        const currentUrls = refreshed?.imageUrls || [];
        if (currentUrls.length <= maxPhotos) continue;

        // Step 2: Score-based trim using stored scores
        const existingScores = await db.collection('photo_scores')
            .find({ playgroundId: place._id })
            .toArray();
        const scoreMap = Object.fromEntries(existingScores.map(r => [r.photoUrl, r.score]));

        const scored = [];
        for (const url of currentUrls) {
            if (scoreMap[url] !== undefined) {
                scored.push({ url, score: scoreMap[url] });
            } else if (url.startsWith('google_photo:')) {
                scored.push({ url, score: 0.5 });
            } else {
                // Fallback: score with Gemini (only for legacy unscored photos)
                try {
                    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
                    const imageBuffer = Buffer.from(response.data, 'binary');
                    const summary = await getGeminiSummary(imageBuffer, 0, place.types || [], place.name || '');
                    const score = computePhotoScore(summary, { hasFaces: false, isMasked: false });
                    scored.push({ url, score });
                    await db.collection('photo_scores').updateOne(
                        { playgroundId: place._id, photoUrl: url },
                        { $set: { score, geminiSummary: summary, source: 'trim_backfill', scoredAt: new Date() } },
                        { upsert: true },
                    );
                } catch (_) {
                    scored.push({ url, score: 0.2 });
                }
            }
        }

        scored.sort((a, b) => b.score - a.score);
        const keep = scored.slice(0, maxPhotos).map(p => p.url);
        const trim = scored.slice(maxPhotos).map(p => p.url);

        console.log(`[trim] ${place.name}: keeping ${keep.length}, trimming ${trim.length}${dryRun ? ' (dry run)' : ''}`);

        if (!dryRun && trim.length > 0) {
            const archiveDocs = trim.map(url => ({
                playgroundId: place._id,
                playgroundName: place.name,
                regionKey: place.regionKey,
                photoUrl: url,
                score: scored.find(s => s.url === url)?.score || 0,
                archivedAt: new Date(),
                archiveReason: 'gallery_trim',
            }));
            await db.collection('archived_photos').insertMany(archiveDocs);

            await db.collection('playgrounds').updateOne(
                { _id: place._id },
                { $set: { imageUrls: keep } },
            );

            await db.collection('photo_scores').deleteMany({
                playgroundId: place._id,
                photoUrl: { $in: trim },
            });
        }

        totalTrimmed += trim.length;
    }

    console.log(`[trim] Done. Deduped: ${totalDeduped}, Trimmed: ${totalTrimmed}${dryRun ? ' (dry run — no writes)' : ''}`);
    return { playgroundsProcessed: playgrounds.length, totalDeduped, totalTrimmed };
}
