const { getDb } = require('../database');

/**
 * @param {import('mongodb').Db} [db]
 * @param {{
 *   regionKey: string,
 *   runType: string,
 *   status?: string,
 *   meta?: object,
 *   errorMessage?: string,
 * }} entry
 */
async function appendRunLog(db, entry) {
  const database = db || getDb();
  const now = new Date();
  const doc = {
    regionKey: entry.regionKey,
    runType: entry.runType,
    status: entry.status || 'complete',
    createdAt: now,
    ...(entry.meta && typeof entry.meta === 'object' ? { meta: entry.meta } : {}),
    ...(entry.errorMessage ? { errorMessage: String(entry.errorMessage).slice(0, 2000) } : {}),
  };
  const res = await database.collection('seed_run_logs').insertOne(doc);
  return { insertedId: res.insertedId, ...doc };
}

module.exports = {
  appendRunLog,
};
