const { resolvePlaygroundIdFilter } = require('../utils/playgroundIdFilter');

/**
 * Parse "New {Category} suggestion: {Label} [Location Type: ...]" from app submit body (message field).
 * Used when structured fields were not stored (legacy clients / serialization quirks).
 */
function parseFeatureSuggestionMessage(message) {
    const s = String(message || '').trim();
    if (!s) return { category: null, label: null };
    const m = /^New\s+(.+?)\s+suggestion:\s*(.+?)(\s*\[Location Type:|\s*$)/is.exec(s);
    if (!m) return { category: null, label: null };
    const category = (m[1] || '').trim() || null;
    const label = (m[2] || '').trim() || null;
    return { category, label };
}

/** Maps AddEditPlaygroundScreen suggestionCategory strings → DB + category_options slug. */
const CATEGORY_CONFIG = {
    'Playground Equipment': { mode: 'array', field: 'equipment', optionsCategory: 'equipment' },
    'Swing Type': { mode: 'array', field: 'swingTypes', optionsCategory: 'swing_type' },
    'Sports Court': { mode: 'array', field: 'sportsCourts', optionsCategory: 'sports_court' },
    'Exercise Equipment': { mode: 'array', field: 'exerciseEquipment', optionsCategory: 'exercise_equipment' },
    'Ground Surface': { mode: 'ground', field: 'groundType', optionsCategory: 'ground_surface' },
    Amenity: { mode: 'amenity' },
};

/** Normalize for case-insensitive amenity label match (display labels → boolean field). */
const AMENITY_LABEL_TO_FIELD = new Map(
    Object.entries({
        bathrooms: 'hasBathrooms',
        shade: 'hasShade',
        fenced: 'isFenced',
        'toddler friendly': 'isToddlerFriendly',
        'dog friendly': 'isDogFriendly',
        parking: 'hasParking',
        'splash pad': 'hasSplashPad',
        accessible: 'isAccessible',
        wifi: 'hasWifi',
        'wi fi': 'hasWifi',
        'walking trail': 'hasWalkingTrail',
        'water fountain': 'hasBottleFiller',
        'bottle filler': 'hasBottleFiller',
        benches: 'hasBenches',
        'picnic tables': 'hasPicnicTables',
        'trash cans': 'hasTrashCans',
        'requires grip socks': 'needsGripSocks',
        'needs grip socks': 'needsGripSocks',
        'requires waiver': 'requiresWaiver',
        'outdoor shower': 'hasOutdoorShower',
        'changing rooms': 'hasChangingRooms',
        lockers: 'hasLockers',
        'nursing room': 'hasNursingRoom',
        'party room': 'hasPartyRoom',
        'covered seating': 'hasCoveredSeating',
        'food services': 'hasFoodServices',
        'snack bar': 'hasSnackBar',
        'alcohol on site': 'hasAlcoholOnSite',
        'gift shop': 'hasGiftShop',
        'rental equipment': 'hasRentalEquipment',
        'card only': 'isCardOnly',
        atm: 'hasATM',
        'height age restrictions': 'hasHeightAgeRestrictions',
        'height/age restrictions': 'hasHeightAgeRestrictions',
        'arcade games': 'hasArcadeGames',
        'stroller friendly': 'isStrollerFriendly',
        'sunscreen station': 'hasSunscreenStation',
        'bug spray station': 'hasBugSprayStation',
        'ev charging': 'hasEVCharging',
    }).map(([k, v]) => [k, v])
);

function normKey(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function titleCaseLabel(s) {
    const t = String(s || '').trim();
    if (!t) return t;
    return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferRegionKeyFromPlayground(pg) {
    const explicit = pg?.regionKey != null ? String(pg.regionKey).trim() : '';
    if (explicit) return explicit;
    const cityRaw = (pg?.normalized && pg.normalized.cityDisplay) || pg?.city || '';
    const stateRaw = (pg?.normalized && pg.normalized.stateCode) || pg?.state || '';
    const city = String(cityRaw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const state = String(stateRaw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 2);
    if (!city || !state) return null;
    return `${city}-${state}`;
}

/**
 * Apply an approved feature suggestion to a playground document and global option catalog.
 * @returns {{ appliedLabel: string, cityForPoints: string|null, stateForPoints: string|null, regionKeyForPoints: string|null }}
 */
async function applyApprovedSuggestion(db, playgroundId, suggestionCategory, rawLabel) {
    const label = titleCaseLabel(rawLabel);
    if (!label) {
        const err = new Error('Suggestion label is empty.');
        err.statusCode = 400;
        throw err;
    }

    const cfg = CATEGORY_CONFIG[suggestionCategory];
    if (!cfg) {
        const err = new Error(`Unknown suggestion category: ${suggestionCategory}`);
        err.statusCode = 400;
        throw err;
    }

    const filter = resolvePlaygroundIdFilter(playgroundId);
    let pg = await db.collection('playgrounds').findOne(filter);
    if (!pg) {
        pg = await db.collection('playgrounds').findOne({ _id: String(playgroundId) });
    }
    if (!pg) {
        const err = new Error('Playground not found for this ticket.');
        err.statusCode = 404;
        throw err;
    }

    const cityForPoints = pg.city || (pg.normalized && pg.normalized.cityDisplay) || null;
    const stateForPoints = pg.state || (pg.normalized && pg.normalized.stateCode) || null;
    const regionKeyForPoints = inferRegionKeyFromPlayground(pg);
    const appliedFilter = { _id: pg._id };

    if (cfg.mode === 'array') {
        // Fetch + dedupe + $set instead of $addToSet so corrupted/non-array fields
        // (legacy docs that stored null/string) don't 500 the approval. Manually-added
        // playgrounds without a region were the most common path here.
        const existing = Array.isArray(pg[cfg.field]) ? pg[cfg.field].slice() : [];
        const has = existing.some((x) => normKey(x) === normKey(label));
        const next = has ? existing : [...existing, label];
        await db.collection('playgrounds').updateOne(appliedFilter, {
            $set: { [cfg.field]: next, updatedAt: new Date() },
        });
        await upsertCategoryOption(db, cfg.optionsCategory, label);
        return { appliedLabel: label, cityForPoints, stateForPoints, regionKeyForPoints };
    }

    if (cfg.mode === 'ground') {
        const existing = String(pg.groundType || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);
        const lower = new Set(existing.map((x) => x.toLowerCase()));
        if (!lower.has(label.toLowerCase())) existing.push(label);
        const merged = existing.join(', ');
        await db.collection('playgrounds').updateOne(appliedFilter, {
            $set: { groundType: merged, updatedAt: new Date() },
        });
        await upsertCategoryOption(db, cfg.optionsCategory, label);
        return { appliedLabel: label, cityForPoints, stateForPoints, regionKeyForPoints };
    }

    if (cfg.mode === 'amenity') {
        const nk = normKey(label);
        const boolField = AMENITY_LABEL_TO_FIELD.get(nk);
        if (boolField) {
            await db.collection('playgrounds').updateOne(appliedFilter, {
                $set: { [boolField]: true, updatedAt: new Date() },
            });
        } else {
            const existing = Array.isArray(pg.customAmenities) ? pg.customAmenities.slice() : [];
            const has = existing.some((x) => normKey(x) === normKey(label));
            const next = has ? existing : [...existing, label];
            await db.collection('playgrounds').updateOne(appliedFilter, {
                $set: { customAmenities: next, updatedAt: new Date() },
            });
        }
        // Always advertise to the global option catalog so it appears as an option going
        // forward, even if it mapped to a known boolean field on this playground.
        await upsertCategoryOption(db, 'amenity', label);
        return { appliedLabel: label, cityForPoints, stateForPoints, regionKeyForPoints };
    }

    const err = new Error('Unsupported suggestion category configuration.');
    err.statusCode = 500;
    throw err;
}

/**
 * Idempotently add `label` to `category_options[category].values`. Repairs docs whose
 * `values` is missing or non-array (legacy data) instead of letting `$addToSet` 500.
 */
async function upsertCategoryOption(db, category, label) {
    const cur = await db.collection('category_options').findOne({ category });
    if (!cur) {
        await db.collection('category_options').insertOne({ category, values: [label] });
        return;
    }
    const values = Array.isArray(cur.values) ? cur.values.slice() : [];
    if (values.some((v) => normKey(v) === normKey(label))) return;
    values.push(label);
    await db.collection('category_options').updateOne(
        { _id: cur._id },
        { $set: { values } }
    );
}

async function buildTargetPlaygroundSummary(db, targetKind, targetId) {
    if (!targetId || String(targetKind || '').toLowerCase() !== 'playground') return null;
    const filter = resolvePlaygroundIdFilter(targetId);
    const pg = await db.collection('playgrounds').findOne(filter);
    if (!pg) return null;
    const name = pg.name || '';
    const city = pg.city || (pg.normalized && pg.normalized.cityDisplay) || '';
    const state = pg.state || (pg.normalized && pg.normalized.stateCode) || '';
    return {
        id: pg._id != null ? String(pg._id) : String(targetId),
        name,
        city,
        state,
        regionKey: inferRegionKeyFromPlayground(pg),
        playgroundType: pg.playgroundType || null,
    };
}

module.exports = {
    applyApprovedSuggestion,
    buildTargetPlaygroundSummary,
    parseFeatureSuggestionMessage,
    CATEGORY_CONFIG,
};
