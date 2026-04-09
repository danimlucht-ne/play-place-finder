/**
 * Live stats derived from playgrounds — avoids maintaining duplicate counters on seeded_regions.
 */

const { ACTIVE_PLAYGROUND_FILTER } = require('./activePlaygroundFilter');

const ACTIVE_PLAYGROUND = ACTIVE_PLAYGROUND_FILTER;

/**
 * @param {import('mongodb').Db} db
 * @param {string[]} regionKeys
 * @returns {Promise<Map<string, number>>} regionKey → count of non-archived playgrounds
 */
async function countActivePlaygroundsByRegionKeys(db, regionKeys) {
    const keys = [...new Set((regionKeys || []).filter(Boolean))];
    const map = new Map(keys.map((k) => [k, 0]));
    if (keys.length === 0) return map;

    const agg = await db
        .collection('playgrounds')
        .aggregate([
            { $match: { ...ACTIVE_PLAYGROUND, regionKey: { $in: keys } } },
            { $group: { _id: '$regionKey', n: { $sum: 1 } } },
        ])
        .toArray();

    for (const row of agg) {
        if (row._id != null) map.set(row._id, row.n);
    }
    return map;
}

module.exports = {
    ACTIVE_PLAYGROUND,
    countActivePlaygroundsByRegionKeys,
};
