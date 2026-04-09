'use strict';

const { getDb } = require('../database');

/**
 * Shared consent snapshot helper — used across multiple route files.
 */
async function getConsentSnapshot(userId) {
    const db = getDb();
    const now = new Date();
    const [latestAdult, latestLocation] = await Promise.all([
        db.collection("user_consents").findOne(
            { userId, consentType: "adult_terms" },
            { sort: { acceptedAt: -1 } }
        ),
        db.collection("user_consents").findOne(
            { userId, consentType: "location_services" },
            { sort: { acceptedAt: -1 } }
        )
    ]);
    return {
        consentSnapshotAt: now,
        adultTermsConsentVersion: latestAdult ? latestAdult.consentVersion : null,
        adultTermsAccepted: latestAdult ? !!latestAdult.accepted : false,
        adultTermsAcceptedAt: latestAdult ? latestAdult.acceptedAt || null : null,
        locationServicesConsentVersion: latestLocation ? latestLocation.consentVersion : null,
        locationServicesAccepted: latestLocation ? !!latestLocation.accepted : false,
        locationServicesAcceptedAt: latestLocation ? latestLocation.acceptedAt || null : null
    };
}

/**
 * Transforms playground data for frontend consumption:
 * 1. Flattens GeoJSON location into latitude/longitude.
 * 2. Qualifies image URLs (Google Photos, local uploads, or absolute URLs).
 */
function transformPlayground(p) {
    const baseUrl = process.env.SERVER_BASE_URL || 'http://localhost:8000';
    const key = process.env.GOOGLE_MAPS_API_KEY;
    const flattened = { ...p };

    delete flattened.googleRaw;

    if (p.normalized && p.normalized.cityDisplay) {
        flattened.city = p.normalized.cityDisplay;
        flattened.state = p.normalized.stateCode || flattened.state;
        flattened.zipCode = p.normalized.postalCode || flattened.zipCode;
    }
    flattened.normalizedCitySlug = p.normalized?.citySlug || null;
    flattened.normalizedCounty = p.normalized?.countyDisplay || null;
    flattened.normalizedNeighborhood = p.normalized?.neighborhood || null;
    flattened.locationNeedsReview = p.admin?.needsReview === true;

    if (p._id) {
        flattened.id = p._id.toString();
    }

    if (p.location && p.location.coordinates) {
        flattened.longitude = p.location.coordinates[0];
        flattened.latitude = p.location.coordinates[1];
    }

    if (p.imageUrls) {
        flattened.imageUrls = p.imageUrls.map(url => {
            if (!url) return "";
            if (url.startsWith('google_photo:')) {
                const photoRef = url.split(':')[1];
                return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photoreference=${photoRef}&key=${key}`;
            }
            if (url.startsWith('http') || url.startsWith('data:')) {
                return url;
            }
            const cleanUrl = url.startsWith('/') ? url.substring(1) : url;
            return `${baseUrl}/${cleanUrl}`;
        });
    } else {
        flattened.imageUrls = [];
    }

    if (Array.isArray(p.subVenues) && p.subVenues.length > 0) {
        flattened.subVenues = p.subVenues.map((sv) => {
            const rawId = sv.id != null ? sv.id : sv._id;
            return {
                ...sv,
                id: rawId != null ? String(rawId) : '',
            };
        });
    }

    return flattened;
}

module.exports = { getConsentSnapshot, transformPlayground };
