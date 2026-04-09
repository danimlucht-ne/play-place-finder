/**
 * Re-infer playgroundType from Google types[] + name (inferPlaygroundType).
 * Used after seeding when rules improve, or to fix stale labels.
 */

const { inferPlaygroundType } = require('./inferPlaygroundType');

/** Legacy / non-canonical values worth re-evaluating on Google-seeded rows */
const STALE_PLAYGROUND_TYPES = new Set([
    'Public',
    'Indoor',
    'Museum',
    'Zoo',
    'Aquarium',
    'Water Park',
    'Skating Rink',
    'City Park',
]);

const MISSING_TYPE_CLAUSE = {
    $or: [
        { playgroundType: { $exists: false } },
        { playgroundType: null },
        { playgroundType: '' },
    ],
};

/**
 * @typedef {'missing' | 'stale_on_seed' | 'recheck_seed' | 'seeded' | 'all'} RecategorizeScope
 */

/**
 * @param {{ regionKey?: string, scope: RecategorizeScope }} opts
 * @returns {object} Mongo filter
 */
function buildRecategorizeFilter({ regionKey, scope }) {
    const rk =
        regionKey != null && String(regionKey).trim() !== '' ? String(regionKey).trim() : null;
    const geo = rk ? { regionKey: rk } : null;

    let typePart;
    switch (scope) {
        case 'missing':
            typePart = MISSING_TYPE_CLAUSE;
            break;
        case 'stale_on_seed':
            typePart = {
                googlePlaceId: { $exists: true, $nin: [null, ''] },
                playgroundType: { $in: Array.from(STALE_PLAYGROUND_TYPES) },
            };
            break;
        case 'recheck_seed':
            typePart = {
                $or: [
                    MISSING_TYPE_CLAUSE,
                    {
                        googlePlaceId: { $exists: true, $nin: [null, ''] },
                        playgroundType: { $in: Array.from(STALE_PLAYGROUND_TYPES) },
                    },
                ],
            };
            break;
        case 'seeded':
            typePart = { googlePlaceId: { $exists: true, $nin: [null, ''] } };
            break;
        case 'all':
            typePart = {};
            break;
        default:
            throw new Error(`Unknown recategorize scope: ${scope}`);
    }

    if (geo && Object.keys(typePart).length === 0) {
        return geo;
    }
    if (!geo) {
        return typePart;
    }
    return { $and: [geo, typePart] };
}

/**
 * @param {object} opts
 * @param {import('mongodb').Db} opts.db
 * @param {boolean} [opts.dryRun=true]
 * @param {RecategorizeScope} [opts.scope='seeded']
 * @param {string} [opts.regionKey]
 * @param {number} [opts.limit] — max documents to scan (undefined = no cap)
 * @param {number} [opts.sampleChanges=50] — max change records returned (0 = none)
 */
async function recategorizePlaygroundTypes({
    db,
    dryRun = true,
    scope = 'seeded',
    regionKey,
    limit,
    sampleChanges = 50,
}) {
    const filter = buildRecategorizeFilter({ regionKey, scope });
    const coll = db.collection('playgrounds');

    const totalMatching = await coll.countDocuments(filter);
    const cursor = coll.find(filter);

    let examined = 0;
    let wouldChange = 0;
    let written = 0;
    const countsByInferred = {};
    /** @type {{ id: string, name?: string, was: string|null, inferred: string }[]} */
    const changes = [];

    for await (const doc of cursor) {
        if (limit != null && examined >= limit) {
            break;
        }
        examined++;

        const inferred = inferPlaygroundType(doc.types || [], doc.name || '');
        const was = doc.playgroundType ?? null;
        if (was === inferred) {
            continue;
        }

        wouldChange++;
        countsByInferred[inferred] = (countsByInferred[inferred] || 0) + 1;

        if (sampleChanges > 0 && changes.length < sampleChanges) {
            changes.push({
                id: doc._id != null ? String(doc._id) : '',
                name: doc.name,
                was,
                inferred,
            });
        }

        if (!dryRun) {
            await coll.updateOne({ _id: doc._id }, { $set: { playgroundType: inferred } });
            written++;
        }
    }

    return {
        dryRun,
        scope,
        regionKey: regionKey || null,
        totalMatching,
        examined,
        wouldChange,
        written: dryRun ? 0 : written,
        countsByInferred,
        changes,
        truncated: limit != null && examined >= limit && examined < totalMatching,
    };
}

module.exports = {
    STALE_PLAYGROUND_TYPES,
    buildRecategorizeFilter,
    recategorizePlaygroundTypes,
};
