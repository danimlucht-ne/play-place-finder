const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { ObjectId } = require('mongodb');
const contributionService = require('../services/contributionService');
const { verifyToken, ensureCanSubmit } = require('../services/authService');
const { computeBadges } = require('../services/badgeService');
const { getConsentSnapshot, transformPlayground } = require('../utils/helpers');
const {
    buildCitySlug,
    NORMALIZATION_VERSION: USER_SUBMIT_NORMALIZATION_VERSION,
} = require('../services/placeLocationNormalizationService');
const { hydratePlaygroundFromPlaceDetails } = require('../services/seedOrchestratorService');
const { reviewPlaygroundSubmission } = require('../services/playgroundSubmissionReviewService');
const { recordVerificationFromPlaygroundEdit } = require('../services/recordVerificationFromEdit');
const {
    resolvePlaygroundIdFilter,
    collectSubsumedPlaygroundIdsForRegion,
    stablePlaygroundIdKey,
    collectAllSubsumedPlaygroundIdsForRegions,
} = require('../utils/playgroundIdFilter');
const { ACTIVE_PLAYGROUND_FILTER } = require('../services/activePlaygroundFilter');

const SubmissionType = {
    PHOTO: 'PHOTO',
    PLAYGROUND_EDIT: 'PLAYGROUND_EDIT',
    NEW_PLAYGROUND: 'NEW_PLAYGROUND',
    REVIEW: 'REVIEW',
    ISSUE_REPORT: 'ISSUE_REPORT',
    ABUSE_TICKET: 'ABUSE_TICKET'
};

const ACTIVE_FILTER = ACTIVE_PLAYGROUND_FILTER;

/**
 * Backwards-compatible wrapper: older deployments may not export
 * collectAllSubsumedPlaygroundIdsForRegions yet.
 */
async function collectAllSubsumedIdsSafe(db, regionKeys) {
    if (typeof collectAllSubsumedPlaygroundIdsForRegions === 'function') {
        return collectAllSubsumedPlaygroundIdsForRegions(db, regionKeys);
    }
    const keys = [...new Set((regionKeys || []).map((k) => String(k).trim()).filter(Boolean))];
    const seenKeys = new Set();
    const out = [];
    for (const regionKey of keys) {
        const chunk = await collectSubsumedPlaygroundIdsForRegion(db, regionKey);
        for (const id of chunk) {
            const key = stablePlaygroundIdKey(id);
            if (!key || seenKeys.has(key)) continue;
            seenKeys.add(key);
            out.push(id);
        }
    }
    return out;
}

/** Aggregation expression: lowercase trimmed tokens from `groundType` CSV on the document. */
function groundTypeNormalizedTokensExpr() {
    return {
        $map: {
            input: { $split: [{ $ifNull: ['$groundType', ''] }, ','] },
            as: 'gtPart',
            in: { $toLower: { $trim: { input: '$$gtPart' } } },
        },
    };
}

/**
 * Parse `groundType` / `groundTypeExclude` query params (comma-separated and/or repeated keys).
 * @param {string|string[]|undefined} param
 * @returns {string[]}
 */
function parseGroundTypeQueryTokens(param) {
    if (param == null || param === '') return [];
    const raw = Array.isArray(param) ? param : [param];
    const out = [];
    for (const part of raw) {
        String(part).split(',').forEach((t) => {
            const s = t.trim().toLowerCase();
            if (s) out.push(s);
        });
    }
    return [...new Set(out)];
}

/**
 * Include: any listed token must appear on the doc (OR across tokens).
 * Exclude: none of the listed tokens may appear (AND across exclusions).
 * Stored field is comma-separated (e.g. "Rubber, Sand").
 * @param {string|string[]|undefined} groundTypeParam
 * @param {string|string[]|undefined} groundTypeExcludeParam
 * @returns {Record<string, unknown>|null}
 */
function buildGroundTypeSearchClause(groundTypeParam, groundTypeExcludeParam) {
    const inc = parseGroundTypeQueryTokens(groundTypeParam);
    const exc = parseGroundTypeQueryTokens(groundTypeExcludeParam);
    const arr = groundTypeNormalizedTokensExpr();
    const parts = [];
    if (inc.length > 0) {
        if (inc.length === 1) {
            parts.push({ $expr: { $in: [inc[0], arr] } });
        } else {
            parts.push({ $or: inc.map((t) => ({ $expr: { $in: [t, arr] } })) });
        }
    }
    for (const t of exc) {
        parts.push({ $expr: { $not: [{ $in: [t, arr] }] } });
    }
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    return { $and: parts };
}

/** Express may leave :id as a string; older middleware could pass an ObjectId instance. */
function normalizeRoutePlaygroundId(param) {
    if (param == null || param === '') return '';
    if (typeof param === 'object' && param !== null && typeof param.toHexString === 'function') {
        return param.toHexString();
    }
    return String(param);
}

/**
 * Client bodies may include nested `_id`, `id`, or Extended JSON `{$oid:"..."}` (from re-posting API shapes).
 * Those break BSON encoding on $set with "input must be a 24 character hex string...".
 */
function denudeExtendedJsonAndDates(value) {
    if (value === null || value === undefined) return value;
    if (value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(denudeExtendedJsonAndDates);
    if (typeof value !== 'object') return value;
    if (typeof value.$oid === 'string' && Object.keys(value).length === 1) {
        return value.$oid;
    }
    if (typeof value.$date === 'string' && Object.keys(value).length === 1) {
        const d = new Date(value.$date);
        return Number.isNaN(d.getTime()) ? value : d;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = denudeExtendedJsonAndDates(v);
    }
    return out;
}

function deepOmitMongoIds(value) {
    if (value === null || value === undefined) return value;
    if (value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(deepOmitMongoIds);
    if (typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (k === '_id') continue;
        out[k] = deepOmitMongoIds(v);
    }
    return out;
}

function sanitizePlaygroundUpdateBody(raw) {
    const spread = { ...(raw || {}) };
    delete spread._id;
    delete spread.id;
    const cleaned = deepOmitMongoIds(denudeExtendedJsonAndDates(spread));
    // Never persist imageUrls as a non-array — breaks transformPlayground and empties home search for all users.
    if (cleaned.imageUrls != null && !Array.isArray(cleaned.imageUrls)) {
        delete cleaned.imageUrls;
    }
    return cleaned;
}

/**
 * Shared helper: upsert a user's rating for a playground, then recalculate
 * the denormalized averageRating and ratingCount on the playground document.
 *
 * @param {string} playgroundId
 * @param {string} userId
 * @param {number} rating  integer 1–5
 * @returns {{ averageRating: number, ratingCount: number }}
 */
async function upsertRatingAndRecalculate(playgroundId, userId, rating) {
    const db = getDb();
    const now = new Date();

    // Upsert the individual rating record
    await db.collection("playground_ratings").updateOne(
        { playgroundId, userId },
        {
            $set: { rating, updatedAt: now },
            $setOnInsert: { createdAt: now }
        },
        { upsert: true }
    );

    // Aggregate all ratings for this playground
    const [agg] = await db.collection("playground_ratings").aggregate([
        { $match: { playgroundId } },
        { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } }
    ]).toArray();

    const averageRating = agg ? Math.round(agg.avg * 10) / 10 : 0;
    const ratingCount = agg ? agg.count : 0;

    // Update the playground document with denormalized values
    const filter = resolvePlaygroundIdFilter(playgroundId);
    await db.collection("playgrounds").updateOne(filter, {
        $set: { averageRating, ratingCount }
    });

    return { averageRating, ratingCount };
}

// GET /api/playgrounds/category-options/:category — fetch approved custom options for a category
router.get("/category-options/:category", async (req, res) => {
    const db = getDb();
    try {
        const doc = await db.collection("category_options").findOne({ category: req.params.category });
        res.json({ message: "success", data: doc ? doc.values : [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET all playgrounds
router.get("/", async (req, res) => {
    const db = getDb();
    try {
        // Exclude libraries from default results unless explicitly requested
        const typeFilter = req.query.playgroundType === 'Library'
            ? { playgroundType: 'Library' }
            : { playgroundType: { $ne: 'Library' } };

        // Cursor-based pagination
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const cursor = req.query.cursor;
        const paginationFilter = cursor ? { _id: { $gt: new ObjectId(cursor) } } : {};

        const playgrounds = await db.collection("playgrounds")
            .find({ ...ACTIVE_FILTER, ...typeFilter, ...paginationFilter })
            .sort({ _id: 1 })
            .limit(limit)
            .toArray();

        // Enrich with favorite status for the authenticated user
        const favIds = new Set();
        if (req.user?.uid) {
            const favs = await db.collection("favorites").find({ userId: req.user.uid }).toArray();
            favs.forEach(f => favIds.add(f.placeId));
        }

        const nextCursor = playgrounds.length === limit ? playgrounds[playgrounds.length - 1]._id.toString() : null;
        res.json({ message: "success", data: playgrounds.map(p => {
            const t = transformPlayground(p);
            t.isFavorited = favIds.has(p._id.toString()) || favIds.has(p._id);
            return t;
        }), nextCursor });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// SEARCH playgrounds with filters and proximity
router.get("/search", async (req, res) => {
    const db = getDb();
    const {
        lat, lng, radius, groundType, groundTypeExclude, equipment, ageRange, sportsCourts,
        isIndoor, isOutdoor, costRange, isAccessible, hasWalkingPath, playgroundType,
        parkingSituation, swingTypes, hasBathrooms, hasShade, isFenced, hasPicnicTables,
        hasWaterFountain, isToddlerFriendly, hasSplashPad, isDogFriendly, hasWalkingTrail,
        hasBenches, hasTrashCans, hasParking, hasWifi, needsGripSocks, requiresWaiver
    } = req.query;

    let query = {};

    if (lat && lng && radius) {
        query.location = {
            $near: {
                $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
                $maxDistance: parseInt(radius) * 1609.34
            }
        };
    }

    const groundClause = buildGroundTypeSearchClause(groundType, groundTypeExclude);
    if (groundClause) Object.assign(query, groundClause);
    if (ageRange) query.ageRange = ageRange;
    if (sportsCourts && sportsCourts.length > 0) query.sportsCourts = { $all: sportsCourts.split(",") };
    if (isIndoor === 'true') query.isIndoor = true;
    if (isOutdoor === 'true') query.isOutdoor = true;
    if (costRange) query.costRange = costRange;
    if (isAccessible === 'true') query.isAccessible = true;
    if (hasWalkingPath === 'true') query.hasWalkingPath = true;
    if (playgroundType) query.playgroundType = playgroundType;
    else query.playgroundType = { $ne: 'Library' }; // hide libraries unless explicitly filtered
    if (parkingSituation) query.parkingSituation = parkingSituation;
    if (hasBathrooms === 'true') query.hasBathrooms = true;
    if (hasShade === 'true') query.hasShade = true;
    if (isFenced === 'true') query.isFenced = true;
    if (hasPicnicTables === 'true') query.hasPicnicTables = true;
    if (hasWaterFountain === 'true') query.hasWaterFountain = true;
    if (isToddlerFriendly === 'true') query.isToddlerFriendly = true;
    if (hasSplashPad === 'true') query.hasSplashPad = true;
    if (isDogFriendly === 'true') query.isDogFriendly = true;
    if (hasWalkingTrail === 'true') query.hasWalkingTrail = true;
    if (hasBenches === 'true') query.hasBenches = true;
    if (hasTrashCans === 'true') query.hasTrashCans = true;
    if (hasParking === 'true') query.hasParking = true;
    if (hasWifi === 'true') query.hasWifi = true;
    if (needsGripSocks === 'true') query.needsGripSocks = true;
    if (requiresWaiver === 'true') query.requiresWaiver = true;
    if (equipment && equipment.length > 0) query.equipment = { $all: equipment.split(",") };
    if (swingTypes && swingTypes.length > 0) query.swingTypes = { $in: swingTypes.split(",") };

    try {
        const results = await db.collection("playgrounds").find({ ...query, ...ACTIVE_FILTER }).toArray();
        const regionKeysForSubsumed = new Set();
        for (const p of results) {
            if (p.regionKey) regionKeysForSubsumed.add(String(p.regionKey).trim());
            for (const ck of p.coveredRegionKeys || []) {
                if (ck) regionKeysForSubsumed.add(String(ck).trim());
            }
        }
        const subsumedRaw = await collectAllSubsumedIdsSafe(db, [...regionKeysForSubsumed]);
        const subsumedKeys = new Set(subsumedRaw.map(stablePlaygroundIdKey));
        const pruned = results.filter((p) => p && p._id != null && !subsumedKeys.has(stablePlaygroundIdKey(p._id)));

        const favIds = new Set();
        if (req.user?.uid) {
            const favs = await db.collection("favorites").find({ userId: req.user.uid }).toArray();
            favs.forEach(f => favIds.add(f.placeId));
        }
        res.json({ message: "success", data: pruned.map(p => {
            const t = transformPlayground(p);
            t.isFavorited = favIds.has(p._id.toString()) || favIds.has(p._id);
            return t;
        }) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET a single playground by ID — no auth required (consistent with GET all / search)
// _id may be ObjectId hex (user submissions) or string (e.g. Google place_id from seed).
router.get("/:id", async (req, res) => {
    const db = getDb();
    try {
        const filter = resolvePlaygroundIdFilter(req.params.id);
        const playground = await db.collection("playgrounds").findOne(filter);
        if (playground) {
            try {
                const patch = await hydratePlaygroundFromPlaceDetails(playground);
                if (patch && Object.keys(patch).length > 0) {
                    await db.collection("playgrounds").updateOne(filter, { $set: patch });
                    Object.assign(playground, patch);
                }
            } catch (_) {
                /* best-effort enrichment */
            }
            const t = transformPlayground(playground);
            if (req.user?.uid) {
                const fav = await db.collection("favorites").findOne({ userId: req.user.uid, placeId: req.params.id });
                t.isFavorited = !!fav;
            }
            // Aggregate recent crowd level (last 2 hours)
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const recentCrowdReports = await db.collection("crowd_reports")
                .find({ placeId: req.params.id, createdAt: { $gte: twoHoursAgo } })
                .sort({ createdAt: -1 })
                .limit(10)
                .toArray();
            if (recentCrowdReports.length > 0) {
                // Use the most common crowd level from recent reports
                const counts = {};
                recentCrowdReports.forEach(r => { counts[r.crowdLevel] = (counts[r.crowdLevel] || 0) + 1; });
                t.crowdLevel = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
            }
            res.json({ message: "success", data: t });
        } else {
            res.status(404).json({ message: "Playground not found" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST a new playground
router.post("/", verifyToken, ensureCanSubmit, async (req, res) => {
    const db = getDb();
    const {
        name, description, atmosphere, groundType, equipment, sportsCourts, imageUrls,
        latitude, longitude, isIndoor, isOutdoor, costRange, isAccessible, hasWalkingPath,
        ageRange, costToEnter, cleanlinessRating, atmosphereRating, crowdRating, modernityRating,
        playgroundType, parkingSituation, swingTypes, customIdentifiers, hasBathrooms, hasShade,
        isFenced, hasPicnicTables, hasWaterFountain, isToddlerFriendly, hasSplashPad, isDogFriendly,
        hasWalkingTrail, safetyScore, amenityScore, hasBenches, hasTrashCans, hasParking, hasWifi,
        needsGripSocks, requiresWaiver, customAmenities, atmosphereList, modernity, kidRating,
        parentRating, notesForAdmin, isAnonymous,
        hasOutdoorShower, hasChangingRooms, hasLockers, hasNursingRoom, hasPartyRoom,
        hasCoveredSeating, hasFoodServices, hasSnackBar, hasAlcoholOnSite, hasGiftShop,
        hasRentalEquipment, isCardOnly, hasATM, hasHeightAgeRestrictions, hasArcadeGames,
        isStrollerFriendly, hasSunscreenStation, hasBugSprayStation, hasEVCharging,
        city: bodyCity, state: bodyState, zipCode: bodyZip,
    } = req.body;
    if (!name) return res.status(400).json({ error: "No name specified" });

    const userLocationPatch = {};
    if (bodyCity && bodyState) {
        const cityDisplay = String(bodyCity).trim();
        const stateCode = String(bodyState).trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
        userLocationPatch.source = 'user_submitted';
        userLocationPatch.city = cityDisplay;
        userLocationPatch.state = stateCode;
        if (bodyZip != null && String(bodyZip).trim()) userLocationPatch.zipCode = String(bodyZip).trim();
        userLocationPatch.normalized = {
            cityDisplay,
            citySlug: buildCitySlug(cityDisplay, stateCode) || null,
            stateCode,
            countyDisplay: null,
            postalCode: bodyZip != null && String(bodyZip).trim() ? String(bodyZip).trim() : null,
            neighborhood: null,
            metroArea: null,
        };
        userLocationPatch.admin = {
            localitySource: 'user_submitted',
            needsReview: false,
            normalizationVersion: USER_SUBMIT_NORMALIZATION_VERSION,
        };
    }

    const newPlayground = {
        name, description, atmosphere, groundType, equipment, sportsCourts, imageUrls,
        latitude, longitude,
        isIndoor: !!isIndoor, isOutdoor: isOutdoor === undefined ? true : !!isOutdoor,
        costRange: costRange || "Free",
        isAccessible: !!isAccessible, hasWalkingPath: !!hasWalkingPath,
        playgroundType: playgroundType || "Public",
        parkingSituation: parkingSituation || "Unknown",
        swingTypes: swingTypes || [], customIdentifiers: customIdentifiers || null,
        hasBathrooms: !!hasBathrooms, hasShade: !!hasShade, isFenced: !!isFenced,
        hasPicnicTables: !!hasPicnicTables, hasWaterFountain: !!hasWaterFountain,
        isToddlerFriendly: !!isToddlerFriendly, hasSplashPad: !!hasSplashPad,
        isDogFriendly: !!isDogFriendly, hasWalkingTrail: !!hasWalkingTrail,
        hasBenches: !!hasBenches, hasTrashCans: !!hasTrashCans, hasParking: !!hasParking,
        hasWifi: !!hasWifi, needsGripSocks: !!needsGripSocks, requiresWaiver: !!requiresWaiver,
        customAmenities: customAmenities || [], atmosphereList: atmosphereList || [],
        modernity: modernity || [],
        cleanlinessRating: cleanlinessRating || 3, atmosphereRating: atmosphereRating || 3,
        crowdRating: crowdRating || 3, modernityRating: modernityRating || 3,
        kidRating: kidRating || 3, parentRating: parentRating || 3,
        safetyScore: safetyScore || 50, amenityScore: amenityScore || 50,
        notesForAdmin: notesForAdmin || null, isAnonymous: !!isAnonymous,
        ...(hasOutdoorShower !== undefined && { hasOutdoorShower: !!hasOutdoorShower }),
        ...(hasChangingRooms !== undefined && { hasChangingRooms: !!hasChangingRooms }),
        ...(hasLockers !== undefined && { hasLockers: !!hasLockers }),
        ...(hasNursingRoom !== undefined && { hasNursingRoom: !!hasNursingRoom }),
        ...(hasPartyRoom !== undefined && { hasPartyRoom: !!hasPartyRoom }),
        ...(hasCoveredSeating !== undefined && { hasCoveredSeating: !!hasCoveredSeating }),
        ...(hasFoodServices !== undefined && { hasFoodServices: !!hasFoodServices }),
        ...(hasSnackBar !== undefined && { hasSnackBar: !!hasSnackBar }),
        ...(hasAlcoholOnSite !== undefined && { hasAlcoholOnSite: !!hasAlcoholOnSite }),
        ...(hasGiftShop !== undefined && { hasGiftShop: !!hasGiftShop }),
        ...(hasRentalEquipment !== undefined && { hasRentalEquipment: !!hasRentalEquipment }),
        ...(isCardOnly !== undefined && { isCardOnly: !!isCardOnly }),
        ...(hasATM !== undefined && { hasATM: !!hasATM }),
        ...(hasHeightAgeRestrictions !== undefined && { hasHeightAgeRestrictions: !!hasHeightAgeRestrictions }),
        ...(hasArcadeGames !== undefined && { hasArcadeGames: !!hasArcadeGames }),
        ...(isStrollerFriendly !== undefined && { isStrollerFriendly: !!isStrollerFriendly }),
        ...(hasSunscreenStation !== undefined && { hasSunscreenStation: !!hasSunscreenStation }),
        ...(hasBugSprayStation !== undefined && { hasBugSprayStation: !!hasBugSprayStation }),
        ...(hasEVCharging !== undefined && { hasEVCharging: !!hasEVCharging }),
        verificationCount: 1, favoriteCount: 0,
        ageRange, costToEnter: costToEnter || "Free",
        lastUpdated: new Date(), submittedByUserId: req.user.uid,
        location: { type: "Point", coordinates: [parseFloat(longitude), parseFloat(latitude)] },
        ...userLocationPatch,
    };

    try {
        const submissionReview = await reviewPlaygroundSubmission({
            name,
            description,
            atmosphere,
            notesForAdmin,
            customAmenities,
            playgroundType,
            imageUrls: imageUrls || [],
        });

        if (submissionReview.autoApprove) {
            const doc = {
                ...newPlayground,
                geminiSubmissionReview: {
                    autoApproved: true,
                    reviewedAt: submissionReview.reviewedAt,
                    minConfidenceThreshold: submissionReview.minConfidenceThreshold,
                    textSeverity: submissionReview.text.severity,
                },
            };
            const result = await db.collection("playgrounds").insertOne(doc);
            await db.collection("moderation_queue").insertOne({
                submissionType: SubmissionType.NEW_PLAYGROUND,
                submissionId: result.insertedId.toHexString(),
                playgroundId: result.insertedId.toHexString(),
                playgroundName: doc.name || null,
                proposedNewPlayground: doc,
                submittedByUserId: req.user.uid,
                status: 'AUTO_APPROVED',
                geminiSubmissionReview: submissionReview,
                reviewedAt: new Date(),
                reviewedBy: 'system:auto-approve',
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            await contributionService.recordContribution(
                req.user.uid, SubmissionType.NEW_PLAYGROUND,
                result.insertedId.toHexString(), newPlayground.city
            );
            return res.status(201).json({
                message: "success",
                data: doc,
                id: result.insertedId,
                submissionReview: { autoApproved: true, review: submissionReview },
            });
        }

        const queueId = new ObjectId();
        await db.collection("moderation_queue").insertOne({
            _id: queueId,
            submissionType: SubmissionType.NEW_PLAYGROUND,
            submissionId: new ObjectId(),
            playgroundId: null,
            playgroundName: name,
            proposedNewPlayground: newPlayground,
            submittedByUserId: req.user.uid,
            geminiSubmissionReview: submissionReview,
            status: 'NEEDS_ADMIN_REVIEW',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        return res.status(202).json({
            message: "Submission is pending admin review.",
            pendingReview: true,
            queueId: queueId.toHexString(),
            submissionReview,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT (update) a playground — queues edit for AI review, then admin approval
router.put("/:id", verifyToken, ensureCanSubmit, async (req, res) => {
    const db = getDb();
    const routeId = normalizeRoutePlaygroundId(req.params.id);
    const updates = sanitizePlaygroundUpdateBody(req.body);
    updates.lastUpdated = new Date();

    // Coerce new amenity boolean fields when present
    const newAmenityFields = [
        'hasOutdoorShower', 'hasChangingRooms', 'hasLockers', 'hasNursingRoom', 'hasPartyRoom',
        'hasCoveredSeating', 'hasFoodServices', 'hasSnackBar', 'hasAlcoholOnSite', 'hasGiftShop',
        'hasRentalEquipment', 'isCardOnly', 'hasATM', 'hasHeightAgeRestrictions', 'hasArcadeGames',
        'isStrollerFriendly', 'hasSunscreenStation', 'hasBugSprayStation', 'hasEVCharging'
    ];
    for (const field of newAmenityFields) {
        if (updates[field] !== undefined) {
            updates[field] = !!updates[field];
        }
    }

    try {
        const filter = resolvePlaygroundIdFilter(routeId);
        const playground = await db.collection("playgrounds").findOne(filter);
        if (!playground) return res.status(404).json({ message: "Playground not found" });

        // Always update by the document's actual _id (type-safe vs string/ObjectId mismatch).
        const idFilter = { _id: playground._id };

        const merged = { ...playground, ...updates };
        const submissionReview = await reviewPlaygroundSubmission({
            name: merged.name,
            description: merged.description,
            atmosphere: merged.atmosphere,
            notesForAdmin: merged.notesForAdmin,
            customAmenities: merged.customAmenities,
            playgroundType: merged.playgroundType,
            imageUrls: merged.imageUrls || [],
        });

        if (submissionReview.autoApprove) {
            const patch = {
                ...updates,
                geminiSubmissionReview: {
                    autoApproved: true,
                    reviewedAt: submissionReview.reviewedAt,
                    minConfidenceThreshold: submissionReview.minConfidenceThreshold,
                    textSeverity: submissionReview.text.severity,
                },
            };
            // Always match the loaded document's _id (avoids string vs ObjectId mismatch on update).
            await db.collection("playgrounds").updateOne(idFilter, { $set: patch });
            let updatedPlayground = await db.collection("playgrounds").findOne(idFilter);
            if (updatedPlayground) {
                const newBadges = computeBadges(updatedPlayground);
                await db.collection("playgrounds").updateOne(idFilter, { $set: { badges: newBadges } });
                updatedPlayground = await db.collection("playgrounds").findOne(idFilter);
            }
            await contributionService.recordContribution(
                req.user.uid,
                SubmissionType.PLAYGROUND_EDIT,
                req.params.id,
                playground.city,
            );
            await db.collection("moderation_queue").insertOne({
                submissionType: SubmissionType.PLAYGROUND_EDIT,
                submissionId: String(playground._id),
                playgroundId: String(playground._id),
                playgroundName: playground.name || 'Unknown',
                proposedChanges: updates,
                submittedByUserId: req.user.uid,
                status: 'AUTO_APPROVED',
                geminiSubmissionReview: submissionReview,
                reviewedAt: new Date(),
                reviewedBy: 'system:auto-approve',
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            try {
                await recordVerificationFromPlaygroundEdit(
                    db,
                    normalizeRoutePlaygroundId(req.params.id),
                    req.user.uid,
                    updatedPlayground || playground,
                );
            } catch (e) {
                console.warn('[playground edit] verification side-effect failed:', e.message);
            }
            return res.json({
                message: "Edit saved.",
                data: transformPlayground(updatedPlayground || playground),
                submissionReview: { autoApproved: true, review: submissionReview },
            });
        }

        const editQueue = await db.collection("moderation_queue").insertOne({
            submissionType: SubmissionType.PLAYGROUND_EDIT,
            submissionId: String(playground._id),
            playgroundId: String(playground._id),
            playgroundName: playground.name || 'Unknown',
            proposedChanges: updates,
            submittedByUserId: req.user.uid,
            status: 'NEEDS_ADMIN_REVIEW',
            geminiSubmissionReview: submissionReview,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        res.status(202).json({
            message: "Edit submitted for review. It will appear once approved.",
            pendingReview: true,
            queueId: editQueue.insertedId.toHexString(),
            submissionReview,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST verify a playground
router.post("/:id/verify", verifyToken, ensureCanSubmit, async (req, res) => {
    const db = getDb();
    const playgroundId = req.params.id;
    const { lat, lng } = req.body || {};
    const now = new Date();
    try {
        if (typeof lat !== 'number' || typeof lng !== 'number') {
            return res.status(400).json({ error: "Location is required to verify." });
        }

        const filter = resolvePlaygroundIdFilter(playgroundId);
        const playground = await db.collection("playgrounds").findOne(filter);
        if (!playground) return res.status(404).json({ message: "Playground not found" });

        // 24-hour cooldown: same user can't verify same place more than once per day
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const recentVerify = await db.collection("location_verifications").findOne({
            locationId: playgroundId,
            userId: req.user.uid,
            verifiedAt: { $gte: twentyFourHoursAgo },
        });
        if (recentVerify) {
            return res.status(429).json({ error: "You already verified this place in the last 24 hours." });
        }

        const coords = playground.location && playground.location.coordinates;
        if (!coords || coords.length !== 2) {
            return res.status(400).json({ error: "Playground location is missing." });
        }

        const toRad = (d) => (d * Math.PI) / 180;
        const [pgLng, pgLat] = coords;
        const R = 6371000;
        const dLat = toRad(pgLat - lat);
        const dLng = toRad(pgLng - lng);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat)) * Math.cos(toRad(pgLat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceMeters = R * c;

        const maxDistanceMeters = parseInt(process.env.VERIFY_MAX_DISTANCE_METERS || "250", 10);
        if (Number.isFinite(maxDistanceMeters) && distanceMeters > maxDistanceMeters) {
            return res.status(403).json({ error: "Verification requires being at the location." });
        }

        const consentSnapshot = await getConsentSnapshot(req.user.uid);

        await db.collection("location_verifications").insertOne({
            locationId: playgroundId,
            userId: req.user.uid,
            verifiedAt: now,
            lat,
            lng,
            distanceMeters,
            ...consentSnapshot
        });

        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const verificationCount30d = await db.collection("location_verifications").countDocuments({
            locationId: playgroundId,
            verifiedAt: { $gte: thirtyDaysAgo }
        });

        await db.collection("playgrounds").updateOne(
            filter,
            {
                $set: { lastVerifiedAt: now, verificationCount30d },
                $inc: { verificationCount: 1 }
            }
        );

        // 9.2 — increment trust scores for all verifiable fields (capped at 1.0)
        const TRUST_INCREMENT = parseFloat(process.env.TRUST_SCORE_INCREMENT || '0.1');
        const verifiableFields = [
            'hasBathrooms', 'hasShade', 'isFenced', 'hasPicnicTables', 'hasWaterFountain',
            'isToddlerFriendly', 'hasSplashPad', 'isDogFriendly', 'hasWalkingTrail', 'hasParking',
            'hasOutdoorShower', 'hasChangingRooms', 'hasLockers', 'hasNursingRoom', 'hasPartyRoom',
            'hasCoveredSeating', 'hasFoodServices', 'hasSnackBar', 'hasAlcoholOnSite', 'hasGiftShop',
            'hasRentalEquipment', 'isCardOnly', 'hasATM', 'hasHeightAgeRestrictions', 'hasArcadeGames',
            'isStrollerFriendly', 'hasSunscreenStation', 'hasBugSprayStation', 'hasEVCharging'
        ];
        const trustInc = {};
        verifiableFields.forEach(f => {
            if (playground[f] !== undefined) {
                const current = (playground.trustScores && playground.trustScores[f]) ?? 0.5;
                trustInc[`trustScores.${f}`] = Math.min(1.0, current + TRUST_INCREMENT) - current;
            }
        });
        if (Object.keys(trustInc).length > 0) {
            await db.collection("playgrounds").updateOne(filter, { $inc: trustInc });
        }

        // 9.11 — recompute badges after verification
        const updatedPlayground = await db.collection("playgrounds").findOne(filter);
        if (updatedPlayground) {
            const newBadges = computeBadges(updatedPlayground);
            await db.collection("playgrounds").updateOne(filter, { $set: { badges: newBadges } });
        }

        await contributionService.recordContribution(req.user.uid, SubmissionType.PLAYGROUND_EDIT, playgroundId);
        res.status(201).json({ message: "success", data: { lastVerifiedAt: now, verificationCount30d } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/playgrounds/:id/rate — submit or update a parent rating
router.post("/:id/rate", verifyToken, ensureCanSubmit, async (req, res) => {
    const db = getDb();
    const playgroundId = req.params.id;
    const { rating } = req.body || {};

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Rating must be an integer between 1 and 5." });
    }

    try {
        const filter = resolvePlaygroundIdFilter(playgroundId);
        const playground = await db.collection("playgrounds").findOne(filter);
        if (!playground) return res.status(404).json({ message: "Playground not found" });

        const { averageRating, ratingCount } = await upsertRatingAndRecalculate(playgroundId, req.user.uid, rating);

        // Recompute badges
        const updatedPlayground = await db.collection("playgrounds").findOne(filter);
        if (updatedPlayground) {
            const newBadges = computeBadges(updatedPlayground);
            await db.collection("playgrounds").updateOne(filter, { $set: { badges: newBadges } });
        }

        res.json({ message: "success", data: { averageRating, ratingCount } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/playgrounds/:id/quick-verify — lightweight verify + optional rating
router.post("/:id/quick-verify", verifyToken, ensureCanSubmit, async (req, res) => {
    const db = getDb();
    const playgroundId = req.params.id;
    const { lat, lng, rating } = req.body || {};
    const now = new Date();

    // Validate lat/lng
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: "lat and lng are required." });
    }

    // Validate optional rating
    if (rating !== undefined && rating !== null) {
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ error: "Rating must be an integer between 1 and 5." });
        }
    }

    try {
        const filter = resolvePlaygroundIdFilter(playgroundId);
        const playground = await db.collection("playgrounds").findOne(filter);
        if (!playground) return res.status(404).json({ message: "Playground not found" });

        // 24-hour cooldown: atomically check + insert to prevent race conditions
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const cooldownResult = await db.collection("location_verifications").updateOne(
            {
                locationId: playgroundId,
                userId: req.user.uid,
                verifiedAt: { $gte: twentyFourHoursAgo },
            },
            {
                $setOnInsert: {
                    locationId: playgroundId,
                    userId: req.user.uid,
                    verifiedAt: now,
                    lat,
                    lng,
                    source: 'quick-verify',
                }
            },
            { upsert: true }
        );
        if (cooldownResult.matchedCount > 0) {
            return res.status(429).json({ error: "You already verified this place in the last 24 hours." });
        }

        // Proximity check (same haversine logic as the existing verify endpoint)
        const coords = playground.location && playground.location.coordinates;
        if (!coords || coords.length !== 2) {
            return res.status(400).json({ error: "Playground location is missing." });
        }

        const toRad = (d) => (d * Math.PI) / 180;
        const [pgLng, pgLat] = coords;
        const R = 6371000;
        const dLat = toRad(pgLat - lat);
        const dLng = toRad(pgLng - lng);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat)) * Math.cos(toRad(pgLat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceMeters = R * c;

        // Skip proximity check if user location is clearly invalid (0,0 = no GPS available)
        const hasValidUserLocation = (lat !== 0 || lng !== 0) && lat != null && lng != null;
        const maxDistanceMeters = parseInt(process.env.VERIFY_MAX_DISTANCE_METERS || "250", 10);
        if (hasValidUserLocation && Number.isFinite(maxDistanceMeters) && distanceMeters > maxDistanceMeters) {
            return res.status(403).json({ error: "Verification requires being at the location." });
        }

        // Atomically increment verificationCount and set lastVerifiedAt
        await db.collection("playgrounds").updateOne(filter, {
            $set: { lastVerifiedAt: now },
            $inc: { verificationCount: 1 }
        });

        // Cooldown record already inserted by the atomic upsert above — update it with distance
        await db.collection("location_verifications").updateOne(
            { locationId: playgroundId, userId: req.user.uid, verifiedAt: now },
            { $set: { distanceMeters } }
        );

        // Optionally upsert rating
        let averageRating = playground.averageRating || null;
        let ratingCount = playground.ratingCount || 0;
        if (rating !== undefined && rating !== null) {
            const result = await upsertRatingAndRecalculate(playgroundId, req.user.uid, rating);
            averageRating = result.averageRating;
            ratingCount = result.ratingCount;
        }

        // Record contribution
        await contributionService.recordContribution(req.user.uid, SubmissionType.PLAYGROUND_EDIT, playgroundId);

        // Recompute badges
        const updatedPlayground = await db.collection("playgrounds").findOne(filter);
        if (updatedPlayground) {
            const newBadges = computeBadges(updatedPlayground);
            await db.collection("playgrounds").updateOne(filter, { $set: { badges: newBadges } });
        }

        const finalPlayground = await db.collection("playgrounds").findOne(filter);
        console.log(`[quick-verify] playgroundId=${playgroundId}, filter=${JSON.stringify(filter)}, finalCount=${finalPlayground?.verificationCount}`);
        res.json({
            message: "success",
            data: {
                lastVerifiedAt: now,
                verificationCount: finalPlayground ? finalPlayground.verificationCount : (playground.verificationCount || 0) + 1,
                averageRating,
                ratingCount
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE a playground (soft delete)
router.delete("/:id", verifyToken, ensureCanSubmit, async (req, res) => {
    const db = getDb();
    try {
        const filter = resolvePlaygroundIdFilter(req.params.id);
        const result = await db.collection("playgrounds").updateOne(
            { ...filter, archivedAt: { $exists: false } },
            { $set: { archivedAt: new Date() } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ message: "Playground not found or already archived" });
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/cities/:regionKey/completion — city completion meter (9.7)
router.get("/cities/:regionKey/completion", async (req, res) => {
    const db = getDb();
    const { regionKey } = req.params;
    try {
        const cached = await db.collection("seeded_regions").findOne({ regionKey });
        if (cached && cached.completionPercent !== undefined && cached.completionCachedAt) {
            const ageMs = Date.now() - new Date(cached.completionCachedAt).getTime();
            if (ageMs < 5 * 60 * 1000) {
                return res.json({ message: "success", data: {
                    regionKey,
                    completionPercent: cached.completionPercent,
                    totalPlaces: cached.completionTotalPlaces || 0,
                    verifiedPlaces: cached.completionVerifiedPlaces || 0,
                }});
            }
        }

        const enrichedFields = [
            'hasBathrooms', 'hasShade', 'isFenced', 'hasPicnicTables', 'hasWaterFountain',
            'isToddlerFriendly', 'hasSplashPad', 'isDogFriendly', 'hasWalkingTrail', 'hasParking',
            'hasOutdoorShower', 'hasChangingRooms', 'hasLockers', 'hasNursingRoom', 'hasPartyRoom',
            'hasCoveredSeating', 'hasFoodServices', 'hasSnackBar', 'hasAlcoholOnSite', 'hasGiftShop',
            'hasRentalEquipment', 'isCardOnly', 'hasATM', 'hasHeightAgeRestrictions', 'hasArcadeGames',
            'isStrollerFriendly', 'hasSunscreenStation', 'hasBugSprayStation', 'hasEVCharging'
        ];

        const subsumedIds = await collectSubsumedPlaygroundIdsForRegion(db, regionKey);
        const listFilter = { ...ACTIVE_FILTER, $or: [{ regionKey }, { coveredRegionKeys: regionKey }] };
        if (subsumedIds.length > 0) listFilter._id = { $nin: subsumedIds };
        const allActive = await db.collection("playgrounds").find(listFilter).toArray();
        const totalPlaces = allActive.length;
        const verifiedPlaces = allActive.filter(p => {
            if ((p.verificationCount || 0) < 1) return false;
            const nonNullCount = enrichedFields.filter(f => p[f] !== null && p[f] !== undefined).length;
            return nonNullCount >= 3;
        }).length;

        const completionPercent = totalPlaces === 0 ? 0 : Math.round((verifiedPlaces / totalPlaces) * 100);

        await db.collection("seeded_regions").updateOne(
            { regionKey },
            { $set: { completionPercent, completionTotalPlaces: totalPlaces, completionVerifiedPlaces: verifiedPlaces, completionCachedAt: new Date() } },
            { upsert: true }
        );

        res.json({ message: "success", data: { regionKey, completionPercent, totalPlaces, verifiedPlaces } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/playgrounds/:id/request-delete — user-initiated soft-delete request (goes to admin queue)
router.post("/:id/request-delete", verifyToken, ensureCanSubmit, async (req, res) => {
    const db = getDb();
    const playgroundId = req.params.id;
    const { reason } = req.body || {};
    try {
        const filter = resolvePlaygroundIdFilter(playgroundId);
        const playground = await db.collection("playgrounds").findOne({ ...filter, ...ACTIVE_FILTER });
        if (!playground) return res.status(404).json({ message: "Playground not found" });

        // Check for existing pending delete request
        const existing = await db.collection("moderation_queue").findOne({
            submissionType: 'DELETE_REQUEST',
            targetId: playgroundId,
            status: 'NEEDS_ADMIN_REVIEW'
        });
        if (existing) {
            return res.status(409).json({ error: "A removal request for this place is already pending." });
        }

        const reasonNorm = reason && String(reason).trim() ? String(reason).trim().slice(0, 2000) : null;

        await db.collection("moderation_queue").insertOne({
            submissionType: 'DELETE_REQUEST',
            playgroundId: playground._id,
            playgroundName: playground.name || null,
            targetId: playgroundId,
            targetName: playground.name || null,
            requestedBy: req.user.uid,
            reason: reasonNorm,
            status: 'NEEDS_ADMIN_REVIEW',
            createdAt: new Date(),
        });

        res.status(201).json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.transformPlayground = transformPlayground;
module.exports.ACTIVE_FILTER = ACTIVE_FILTER;
module.exports.upsertRatingAndRecalculate = upsertRatingAndRecalculate;
module.exports.resolvePlaygroundIdFilter = resolvePlaygroundIdFilter;
