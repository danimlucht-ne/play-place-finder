/**
 * Helpers for advertiser-facing campaign list/detail (labels + stable calendar dates).
 */

function calendarYmdFromValue(d) {
  if (d == null || d === '') return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.trim())) return d.trim().slice(0, 10);
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  // Use UTC calendar parts so ISO/BSON instants align with stored YYYY-MM-DD (avoids host-TZ shifting a day).
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pure calendar end date: start YYYY-MM-DD + deltaMonths (same rules as Date#setMonth for typical starts).
 * @param {string} ymd
 * @param {number} deltaMonths
 * @returns {string}
 */
function addCalendarMonthsYmd(ymd, deltaMonths) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return '';
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const totalMonths = y * 12 + (mo - 1) + deltaMonths;
  const newY = Math.floor(totalMonths / 12);
  const newMo = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(newY, newMo, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${newY}-${String(newMo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * @param {import('mongodb').Db} db
 * @param {string[]} regionKeys
 * @returns {Promise<Record<string, string>>}
 */
async function regionKeyToLabelMap(db, regionKeys) {
  const keys = [...new Set((regionKeys || []).filter(Boolean).map((k) => String(k)))];
  if (keys.length === 0) return {};
  const regions = await db.collection('seeded_regions').find({ regionKey: { $in: keys } }).toArray();
  const out = {};
  for (const r of regions) {
    const rk = r.regionKey;
    if (!rk) continue;
    const city = (r.city && String(r.city).trim()) || '';
    const st = (r.state && String(r.state).trim()) || '';
    out[rk] = city ? (st ? `${city}, ${st}` : city) : rk;
  }
  return out;
}

module.exports = {
  calendarYmdFromValue,
  addCalendarMonthsYmd,
  regionKeyToLabelMap,
};
