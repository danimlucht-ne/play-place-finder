const { ObjectId } = require('mongodb');

/**
 * Resolve a playground _id that may be an ObjectId hex string or a plain string (e.g. Google place_id).
 */
function resolvePlaygroundIdFilter(id) {
    if (id == null || id === '') {
        return { _id: id };
    }
    const s = String(id);
    if (/^[a-fA-F0-9]{24}$/.test(s)) {
        try {
            return { _id: new ObjectId(s) };
        } catch {
            return { _id: s };
        }
    }
    return { _id: s };
}

/**
 * Playground IDs that appear as another row's sub-venue in this region. Those should not be
 * returned as separate list/map pins if a duplicate top-level document still exists (e.g. after re-seed).
 *
 * @param {import('mongodb').Db} db
 * @param {string} regionKey
 * @returns {Promise<Array>} Raw BSON ids suitable for `{ _id: { $nin: ... } }`
 */
async function collectSubsumedPlaygroundIdsForRegion(db, regionKey) {
    if (!regionKey) return [];
    const docs = await db
        .collection('playgrounds')
        .find({
            $or: [{ regionKey }, { coveredRegionKeys: regionKey }],
            archivedAt: { $exists: false },
            subVenues: { $elemMatch: { id: { $exists: true, $ne: null } } },
        })
        .project({ subVenues: 1 })
        .toArray();

    const out = [];
    const seen = new Set();
    for (const d of docs) {
        for (const sv of d.subVenues || []) {
            const id = sv?.id;
            if (id == null) continue;
            const k = `${typeof id}:${String(id)}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(id);
        }
    }
    return out;
}

module.exports = { resolvePlaygroundIdFilter, collectSubsumedPlaygroundIdsForRegion };
