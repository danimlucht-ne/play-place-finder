'use strict';

const { ACTIVE_PLAYGROUND_FILTER } = require('./activePlaygroundFilter');

/** Primary metros that have a `seeded_regions` row — never treat as a "legacy" key to remap away. */
async function loadSeededMetropolitanKeys(db) {
  const rows = await db.collection('seeded_regions').find({}, { projection: { regionKey: 1 } }).toArray();
  return new Set(rows.map((r) => String(r.regionKey)).filter(Boolean));
}

/** If many live rows still use `legacyKey` as PRIMARY `regionKey`, require enough coverage evidence. */
const MIN_PRIMARY_ROWS_FOR_EVIDENCE_RATIO = 20;
const COVERAGE_EVIDENCE_MIN_RATIO = 0.12; // supportCount >= primaryCount * this

async function filterWeakCoverageEvidence(db, rows) {
  const out = [];
  for (const row of rows) {
    const legacyKey = String(row._id);
    const primaryCount = await db.collection('playgrounds').countDocuments({
      regionKey: legacyKey,
      ...ACTIVE_PLAYGROUND_FILTER,
    });
    if (
      primaryCount > MIN_PRIMARY_ROWS_FOR_EVIDENCE_RATIO
      && row.supportCount < primaryCount * COVERAGE_EVIDENCE_MIN_RATIO
    ) {
      continue;
    }
    out.push(row);
  }
  return out;
}

/**
 * Build legacy regionKey -> umbrella metro mapping from LIVE playgrounds:
 * for each distinct value in `coveredRegionKeys`, the dominant `regionKey`
 * among rows that list it (highest count) is the metro that "owns" coverage
 * for that legacy key.
 *
 * Drops any pair whose legacy key is itself a seeded metro (when `seeded_regions` lists it).
 * Also drops pairs where many playgrounds still use the legacy key as PRIMARY `regionKey`
 * but `supportCount` from the coverage graph is tiny (handles missing/stale `seeded_regions`).
 *
 * @param {import('mongodb').Db} db
 * @param {{ onlyMetro?: string|null }} [options]
 * @returns {Promise<Array<{ _id: string, metro: string, supportCount: number }>>}
 */
async function buildLegacyToMetroMapping(db, options = {}) {
  const { onlyMetro = null } = options;
  const seededMetropolitanKeys = await loadSeededMetropolitanKeys(db);

  const pipeline = [
    {
      $match: {
        ...ACTIVE_PLAYGROUND_FILTER,
        coveredRegionKeys: { $exists: true, $type: 'array', $ne: [] },
      },
    },
    { $unwind: '$coveredRegionKeys' },
    {
      $group: {
        _id: { legacyKey: '$coveredRegionKeys', metro: '$regionKey' },
        n: { $sum: 1 },
      },
    },
    { $sort: { '_id.legacyKey': 1, n: -1 } },
    {
      $group: {
        _id: '$_id.legacyKey',
        metro: { $first: '$_id.metro' },
        supportCount: { $first: '$n' },
      },
    },
    {
      $match: {
        $expr: { $ne: ['$_id', '$metro'] },
      },
    },
    { $sort: { _id: 1 } },
  ];

  let rows = await db.collection('playgrounds').aggregate(pipeline).toArray();
  rows = rows.filter((r) => !seededMetropolitanKeys.has(String(r._id)));
  rows = await filterWeakCoverageEvidence(db, rows);
  if (onlyMetro) {
    rows = rows.filter((r) => r.metro === onlyMetro);
  }
  return rows;
}

/**
 * Remap `regionKey` on playgrounds + archived_playgrounds for legacy keys that
 * appear in another row's `coveredRegionKeys` (metro umbrella pattern).
 *
 * @param {import('mongodb').Db} db
 * @param {{ dryRun?: boolean, onlyMetro?: string|null }} [options]
 * @returns {Promise<{
 *   dryRun: boolean,
 *   onlyMetro: string|null,
 *   mapping: Array<{ from: string, to: string, supportCount: number, liveMatched?: number, archivedMatched?: number }>,
 *   playgroundsModified?: number,
 *   archivesModified?: number,
 * }>}
 */
async function remapLegacyRegionKeysFromCoverage(db, options = {}) {
  const dryRun = options.dryRun !== false;
  const onlyMetro = options.onlyMetro != null && String(options.onlyMetro).trim() !== ''
    ? String(options.onlyMetro).trim()
    : null;

  const mappingRows = await buildLegacyToMetroMapping(db, { onlyMetro });
  const mapping = [];

  let playgroundsModified = 0;
  let archivesModified = 0;

  for (const row of mappingRows) {
    const from = row._id;
    const to = row.metro;
    if (!from || !to || from === to) continue;

    if (dryRun) {
      const [liveMatched, archivedMatched] = await Promise.all([
        db.collection('playgrounds').countDocuments({ regionKey: from, ...ACTIVE_PLAYGROUND_FILTER }),
        db.collection('archived_playgrounds').countDocuments({ regionKey: from }),
      ]);
      mapping.push({
        from,
        to,
        supportCount: row.supportCount,
        liveMatched,
        archivedMatched,
      });
      continue;
    }

    const liveRes = await db.collection('playgrounds').updateMany(
      { regionKey: from, ...ACTIVE_PLAYGROUND_FILTER },
      { $set: { regionKey: to, updatedAt: new Date() } },
    );
    playgroundsModified += liveRes.modifiedCount || 0;

    await db.collection('archived_playgrounds').updateMany(
      { regionKey: from, archivedRegionKeyBeforeUmbrellaRemap: { $exists: false } },
      { $set: { archivedRegionKeyBeforeUmbrellaRemap: from } },
    );
    const archRes = await db.collection('archived_playgrounds').updateMany(
      { regionKey: from },
      { $set: { regionKey: to } },
    );
    archivesModified += archRes.modifiedCount || 0;

    mapping.push({
      from,
      to,
      supportCount: row.supportCount,
      liveMatched: liveRes.matchedCount,
      archivedMatched: archRes.matchedCount,
    });
  }

  return {
    dryRun,
    onlyMetro,
    mapping,
    ...(dryRun ? {} : { playgroundsModified, archivesModified }),
  };
}

module.exports = {
  buildLegacyToMetroMapping,
  remapLegacyRegionKeysFromCoverage,
};
