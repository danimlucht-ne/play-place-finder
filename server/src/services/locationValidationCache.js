/**
 * Mongo cache for Gemini location scrub outcomes (keyed by Google place id = playground _id).
 */

const COLL = 'gemini_location_validation_cache';

/**
 * @param {import('mongodb').Db} db
 * @param {string[]} placeIds
 * @returns {Promise<Map<string, { valid: boolean, source: string }>>}
 */
async function getManyCached(db, placeIds) {
  const ids = [...new Set((placeIds || []).filter((id) => id != null && id !== '').map((id) => String(id)))];
  const map = new Map();
  if (ids.length === 0) return map;

  const docs = await db
    .collection(COLL)
    .find({ _id: { $in: ids } })
    .toArray();

  for (const d of docs) {
    map.set(String(d._id), { valid: !!d.valid, source: d.source || 'gemini' });
  }
  return map;
}

/**
 * @param {import('mongodb').Db} db
 * @param {string} placeId
 * @param {boolean} valid
 * @param {'rule' | 'gemini'} source
 */
async function setCached(db, placeId, valid, source) {
  const id = String(placeId);
  await db.collection(COLL).updateOne(
    { _id: id },
    { $set: { valid, decidedAt: new Date(), source } },
    { upsert: true },
  );
}

module.exports = { COLL, getManyCached, setCached };
