const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { geocodeTextQuery, geocodeLatLng, normalizeRegionKey, handleHybridSearch } = require('../services/seedOrchestratorService');
const { transformPlayground } = require('../utils/helpers');
const { collectSubsumedPlaygroundIdsForRegion } = require('../utils/playgroundIdFilter');
const { ACTIVE_PLAYGROUND_FILTER } = require('../services/activePlaygroundFilter');

const ACTIVE_FILTER = ACTIVE_PLAYGROUND_FILTER;

/** Same default as GET /playgrounds/search: hide libraries unless explicitly filtered. */
const REGION_SEARCH_TYPE_FILTER = { playgroundType: { $ne: 'Library' } };

/**
 * Playgrounds near a point regardless of regionKey — fixes empty results when the address
 * resolves to a different municipality than stored data (e.g. suburb vs parent metro).
 */
async function fetchPlaygroundsNear(db, lat, lng, maxDistanceMiles, limit = 50) {
    const maxMeters = maxDistanceMiles * 1609.34;
    return db.collection('playgrounds')
        .find({
            ...ACTIVE_FILTER,
            ...REGION_SEARCH_TYPE_FILTER,
            location: {
                $near: {
                    $geometry: { type: 'Point', coordinates: [lng, lat] },
                    $maxDistance: maxMeters,
                },
            },
        })
        .limit(limit)
        .toArray();
}

function mergePlaygroundsById(primary, secondary) {
    const map = new Map();
    for (const p of primary) map.set(String(p._id), p);
    for (const p of secondary) {
        const k = String(p._id);
        if (!map.has(k)) map.set(k, p);
    }
    return [...map.values()];
}

/**
 * Body: either { query: string } or { lat, lng } (numbers or numeric strings).
 * Coordinates path is for "use my location" — same playground merge as text search.
 */
function parseGeoFromSearchBody(body) {
    if (!body || typeof body !== 'object') {
        return { error: 'JSON body required' };
    }
    const { query, lat: latRaw, lng: lngRaw } = body;
    const hasQuery = typeof query === 'string' && query.trim().length > 0;
    if (hasQuery) {
        if (query.length > 100) return { error: 'query must be at most 100 chars' };
        return { mode: 'query', query: query.trim() };
    }
    const lat = typeof latRaw === 'number' ? latRaw : parseFloat(latRaw);
    const lng = typeof lngRaw === 'number' ? lngRaw : parseFloat(lngRaw);
    const ok = Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    if (ok) return { mode: 'coords', lat, lng };
    return { error: 'Provide query (non-empty string) or valid lat and lng' };
}

// POST /search — geocode a city/state query or reverse-geocode coords; return playgrounds
router.post('/search', async (req, res) => {
    const parsed = parseGeoFromSearchBody(req.body);
    if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
    }

    try {
        let geoResult;
        if (parsed.mode === 'query') {
            geoResult = await geocodeTextQuery(parsed.query);
        } else {
            const gd = await geocodeLatLng(parsed.lat, parsed.lng);
            if (gd.country !== 'US') {
                return res.status(400).json({ error: 'Play Spotter is currently available in the United States only.' });
            }
            geoResult = {
                lat: parsed.lat,
                lng: parsed.lng,
                city: gd.city,
                state: gd.state,
                country: gd.country,
                normalizedRegion: gd.normalizedRegion,
            };
        }

        const nr = geoResult.normalizedRegion;
        const regionKey =
            nr && nr.citySlug && String(nr.citySlug).length > 0
                ? nr.citySlug
                : normalizeRegionKey(geoResult.city, geoResult.state);
        const db = getDb();
        const existing = await db.collection('seeded_regions').findOne({ regionKey });

        const centerPoint = { lat: geoResult.lat, lng: geoResult.lng };
        const coordsOnly = parsed.mode === 'coords';

        if (existing) {
            const byRegion = await db.collection('playgrounds')
                .find({ regionKey, ...ACTIVE_FILTER })
                .limit(50)
                .toArray();
            const near = await fetchPlaygroundsNear(db, geoResult.lat, geoResult.lng, 50);
            const merged = mergePlaygroundsById(byRegion, near);
            return res.json({
                regionKey,
                city: existing.displayCity || existing.city,
                state: existing.state,
                center: existing.center,
                seeded: true,
                seedingTriggered: false,
                places: merged.map(transformPlayground),
            });
        }

        const nearBeforeSeed = await fetchPlaygroundsNear(db, geoResult.lat, geoResult.lng, 50);
        // GPS flow: client already POSTs /search/hybrid on startup — avoid running handleHybridSearch twice.
        if (coordsOnly) {
            return res.json({
                regionKey,
                city: geoResult.city,
                state: geoResult.state,
                center: centerPoint,
                seeded: false,
                seedingTriggered: false,
                places: nearBeforeSeed.map(transformPlayground),
            });
        }

        const seedResult = await handleHybridSearch(
            geoResult.lat, geoResult.lng, req.user?.uid ?? null
        );
        const hybridPlaces = seedResult.places || [];
        const mergedNewRegion = mergePlaygroundsById(nearBeforeSeed, hybridPlaces);
        return res.json({
            regionKey,
            city: geoResult.city,
            state: geoResult.state,
            center: centerPoint,
            seeded: false,
            seedingTriggered: true,
            places: mergedNewRegion.map(transformPlayground),
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /by-region — paginated playgrounds for a given regionKey
router.get('/by-region', async (req, res) => {
    const { regionKey, limit = '50', skip = '0' } = req.query;
    if (!regionKey) {
        return res.status(400).json({ error: 'regionKey is required' });
    }

    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const sk = Math.max(parseInt(skip, 10) || 0, 0);

    try {
        const db = getDb();
        const subsumedIds = await collectSubsumedPlaygroundIdsForRegion(db, regionKey);
        const filter = { ...ACTIVE_FILTER, $or: [{ regionKey }, { coveredRegionKeys: regionKey }] };
        if (subsumedIds.length > 0) filter._id = { $nin: subsumedIds };
        const [places, total] = await Promise.all([
            db.collection('playgrounds').find(filter).skip(sk).limit(lim).toArray(),
            db.collection('playgrounds').countDocuments(filter),
        ]);
        return res.json({
            message: 'success',
            data: places.map(transformPlayground),
            total,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /autocomplete — Google Places Autocomplete for US locations (cities, addresses, zip codes)
router.get('/autocomplete', async (req, res) => {
    const { input } = req.query;
    if (!input || input.length < 2) {
        return res.json({ predictions: [] });
    }

    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    try {
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:us&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await require('axios').get(url);
        const predictions = (response.data.predictions || []).map(p => ({
            description: p.description,
            placeId: p.place_id,
        }));
        res.json({ predictions });
    } catch (err) {
        res.json({ predictions: [] });
    }
});

module.exports = router;
