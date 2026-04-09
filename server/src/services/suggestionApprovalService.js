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

/**
 * Apply an approved feature suggestion to a playground document and global option catalog.
 * @returns {{ appliedLabel: string, cityForPoints: string|null }}
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
    const pg = await db.collection('playgrounds').findOne(filter);
    if (!pg) {
        const err = new Error('Playground not found for this ticket.');
        err.statusCode = 404;
        throw err;
    }

    const cityForPoints = pg.city || (pg.normalized && pg.normalized.cityDisplay) || null;

    if (cfg.mode === 'array') {
        await db.collection('playgrounds').updateOne(filter, {
            $addToSet: { [cfg.field]: label },
            $set: { updatedAt: new Date() },
        });
        await db.collection('category_options').updateOne(
            { category: cfg.optionsCategory },
            { $addToSet: { values: label } },
            { upsert: true }
        );
        return { appliedLabel: label, cityForPoints };
    }

    if (cfg.mode === 'ground') {
        const existing = String(pg.groundType || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);
        const lower = new Set(existing.map((x) => x.toLowerCase()));
        if (!lower.has(label.toLowerCase())) existing.push(label);
        const merged = existing.join(', ');
        await db.collection('playgrounds').updateOne(filter, {
            $set: { groundType: merged, updatedAt: new Date() },
        });
        await db.collection('category_options').updateOne(
            { category: cfg.optionsCategory },
            { $addToSet: { values: label }, $setOnInsert: { category: cfg.optionsCategory, values: [] } },
            { upsert: true }
        );
        return { appliedLabel: label, cityForPoints };
    }

    if (cfg.mode === 'amenity') {
        const nk = normKey(label);
        const boolField = AMENITY_LABEL_TO_FIELD.get(nk);
        if (boolField) {
            await db.collection('playgrounds').updateOne(filter, {
                $set: { [boolField]: true, updatedAt: new Date() },
            });
        } else {
            await db.collection('playgrounds').updateOne(filter, {
                $addToSet: { customAmenities: label },
                $set: { updatedAt: new Date() },
            });
            await db.collection('category_options').updateOne(
                { category: 'amenity' },
                { $addToSet: { values: label } },
                { upsert: true }
            );
        }
        return { appliedLabel: label, cityForPoints };
    }

    const err = new Error('Unsupported suggestion category configuration.');
    err.statusCode = 500;
    throw err;
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
        regionKey: pg.regionKey || null,
        playgroundType: pg.playgroundType || null,
    };
}

module.exports = {
    applyApprovedSuggestion,
    buildTargetPlaygroundSummary,
    parseFeatureSuggestionMessage,
    CATEGORY_CONFIG,
};
