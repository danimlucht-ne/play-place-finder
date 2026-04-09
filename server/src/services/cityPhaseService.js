const { getDb } = require('../database');
const { regionKeyCandidates } = require('../utils/regionKeyForAds');

/**
 * City ad phase for open regions: only `growing` | `mature` in `cityAdSettings`.
 * No `cityAdSettings` row = advertising not open yet (getCityPhase still reports a virtual
 * `phase: 'seeding'` + `advertisingOpen: false` for gating, same as before).
 *
 * User count drives mature: `AD_PHASE_MATURE_MIN_USERS` (users with top-level `regionKey`
 * equal to the region's `cityId` — see countUsersInRegion). When unset, threshold is
 * +Infinity so regions never auto-flip to mature until the env is set.
 */

const VALID_PHASES = ['growing', 'mature'];

/** Default phase pricing (cents) for new/ opened regions — `phasePricing.growing` / `phasePricing.mature`. */
const DEFAULT_OPEN_REGION_PHASE_PRICING = {
  growing: { featured: 14900, sponsored: 4900, event_7d: 1300, event_14d: 2500 },
  mature: { featured: 19900, sponsored: 5900, event_7d: 1500, event_14d: 3000 },
};

/**
 * Mature when user count >= this. Missing or non-positive = +Infinity (no auto-mature flips).
 */
function getMatureUserThreshold() {
  const raw = process.env.AD_PHASE_MATURE_MIN_USERS;
  if (raw == null || String(raw).trim() === '') return Number.POSITIVE_INFINITY;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/**
 * @param {number} userCount
 * @returns {'growing' | 'mature'}
 */
function resolvePhaseForUserCount(userCount) {
  const t = getMatureUserThreshold();
  if (userCount >= t && Number.isFinite(t)) {
    return 'mature';
  }
  return 'growing';
}

/**
 * @param {string} cityId — regionKey, must match `users.regionKey` for the same home region
 * @returns {Promise<number>}
 */
async function countUsersInRegion(cityId) {
  const db = getDb();
  return db.collection('users').countDocuments({ regionKey: cityId });
}

/**
 * @param {string|undefined} phase
 * @returns {'growing' | 'mature' | 'seeding'}
 */
function normalizeStoredPhaseForRead(phase) {
  if (phase == null) return 'seeding';
  if (phase === 'mature') return 'mature';
  if (phase === 'seeding') return 'seeding';
  // beta, growth, growing, or unknown → grow bucket
  return 'growing';
}

/**
 * Pick the phasePricing sub-doc for a logical phase, with legacy `growth` key support.
 * @param {Object} settings - cityAdSettings
 * @param {'growing' | 'mature'} logicalPhase
 */
function priceRowForPhase(settings, logicalPhase) {
  const pp = settings.phasePricing;
  if (!pp) return null;
  if (logicalPhase === 'mature') {
    return pp.mature ?? null;
  }
  return pp.growing ?? pp.growth ?? null;
}

/**
 * Client/API phase + gating. No `slotsRemaining` — inventory is uncapped.
 * - No row: `seeding`, `advertisingOpen: false`, `pricing: null`
 * - Open: `growing` | `mature`, `advertisingOpen: true`, `pricing` for the active phase
 *
 * @param {string} cityId — regionKey
 * @returns {Promise<{ phase: string, advertisingOpen: boolean, pricing: Object|null }>}
 */
async function getCityPhase(cityId) {
  const db = getDb();
  const candidates = regionKeyCandidates(cityId);
  const settings = candidates.length > 0
    ? await db.collection('cityAdSettings').findOne({ cityId: { $in: candidates } })
    : null;

  if (!settings) {
    return {
      phase: 'seeding',
      advertisingOpen: false,
      pricing: null,
    };
  }

  const raw = settings.phase;
  const logical = normalizeStoredPhaseForRead(raw);
  if (logical === 'seeding') {
    // Legacy: row existed with seeding; treat as not yet priced — still "closed" for purchases
    return {
      phase: 'seeding',
      advertisingOpen: false,
      pricing: null,
    };
  }

  const displayPhase = logical; // 'growing' | 'mature'
  return {
    phase: displayPhase,
    advertisingOpen: true,
    pricing: priceRowForPhase(settings, displayPhase),
  };
}

/**
 * @param {string} cityId
 * @returns {Promise<'growing' | 'mature'>}
 */
async function computeOpenPhaseForCity(cityId) {
  const n = await countUsersInRegion(cityId);
  return resolvePhaseForUserCount(n);
}

/**
 * First-ad or admin "open" bootstrap: set `cityAdSettings` with phase from user count,
 * `phasePricing`, strip slot fields.
 * @param {string} cityId
 * @param {object} [opts]
 * @param {boolean} [opts.lockPhase] - if true, set phaseOverride so user job does not change phase
 * @param {Object} [opts.phasePricing] - override default pricing
 */
async function openAdvertisingForRegion(cityId, opts = {}) {
  const db = getDb();
  const now = new Date();
  const phase = await computeOpenPhaseForCity(cityId);
  const merged = { ...DEFAULT_OPEN_REGION_PHASE_PRICING, ...(opts.phasePricing || {}) };
  if (merged.growth && !merged.growing) {
    merged.growing = merged.growth;
    delete merged.growth;
  }
  const phasePricing = {
    growing: merged.growing,
    mature: merged.mature,
  };

  await db.collection('cityAdSettings').updateOne(
    { cityId },
    {
      $set: {
        cityId,
        phase,
        phasePricing,
        phaseChangedAt: now,
        updatedAt: now,
        phaseOverride: Boolean(opts.lockPhase),
      },
      $unset: { slots: '', waitlist: '', transitionRules: '' },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
}

/**
 * One-time rewrites: legacy `growth` / `beta` / slot fields. Run at server startup (not every cron tick).
 * - Stays `seeding` if still closed; otherwise `growing` or `mature`
 */
async function migrateLegacyCityAdSettingsShape(now = new Date()) {
  const db = getDb();
  const cities = await db.collection('cityAdSettings').find({}).toArray();

  for (const city of cities) {
    const p = city.phase;
    const unset = {};
    if (city.slots != null) unset.slots = '';
    if (city.waitlist != null) unset.waitlist = '';
    if (city.transitionRules != null) unset.transitionRules = '';

    const pp = { ...(city.phasePricing || {}) };
    if (pp.growth && !pp.growing) {
      pp.growing = { ...pp.growth };
      delete pp.growth;
    }
    if (pp.beta && !pp.growing) {
      pp.growing = { ...pp.beta };
      delete pp.beta;
    }
    if (!pp.growing && !pp.mature) {
      pp.growing = { ...DEFAULT_OPEN_REGION_PHASE_PRICING.growing };
      pp.mature = { ...DEFAULT_OPEN_REGION_PHASE_PRICING.mature };
    }

    let newPhase;
    if (p === 'mature') {
      newPhase = 'mature';
    } else if (p === 'seeding') {
      newPhase = 'seeding';
    } else {
      newPhase = 'growing';
    }

    const $set = {
      phase: newPhase,
      phasePricing: {
        growing: pp.growing,
        mature: pp.mature,
      },
      updatedAt: now,
    };
    const update = Object.keys(unset).length
      ? { $set, $unset: unset }
      : { $set };

    await db.collection('cityAdSettings').updateOne({ _id: city._id }, update);
  }
}

/**
 * Recompute `growing` | `mature` from user counts for all cities (respects `phaseOverride`).
 * @returns {Promise<{ updated: string[], migrated: number }>}
 */
async function syncRegionAdPhasesFromUserCounts() {
  const db = getDb();
  const now = new Date();
  const t = getMatureUserThreshold();
  const list = await db.collection('cityAdSettings')
    .find({ phaseOverride: { $ne: true } })
    .toArray();
  const updated = [];

  for (const s of list) {
    if (s.phaseOverride === true) continue;
    if (s.phase === 'seeding' || s.phase == null) continue;
    const n = await countUsersInRegion(s.cityId);
    const next = resolvePhaseForUserCount(n);
    const current = s.phase === 'mature' ? 'mature' : 'growing';
    if (current === next) continue;
    await db.collection('cityAdSettings').updateOne(
      { _id: s._id },
      { $set: { phase: next, phaseChangedAt: now, updatedAt: now } }
    );
    updated.push(`${s.cityId}: ${current}→${next}`);
  }

  return { updated, threshold: Number.isFinite(t) ? t : Infinity };
}

/**
 * Sets phase and locks automated user-based transitions.
 * @param {string} cityId
 * @param {string} newPhase — 'growing' | 'mature'
 */
async function setPhaseOverride(cityId, newPhase) {
  if (!VALID_PHASES.includes(newPhase)) {
    throw new Error(`Invalid phase: ${newPhase}. Must be one of: ${VALID_PHASES.join(', ')}`);
  }
  const db = getDb();
  const now = new Date();
  const existing = await db.collection('cityAdSettings').findOne({ cityId });
  let phasePricing = { ...DEFAULT_OPEN_REGION_PHASE_PRICING };
  if (existing?.phasePricing) {
    const e = { ...existing.phasePricing };
    if (e.growth && !e.growing) e.growing = e.growth;
    phasePricing = {
      growing: { ...DEFAULT_OPEN_REGION_PHASE_PRICING.growing, ...e.growing },
      mature: { ...DEFAULT_OPEN_REGION_PHASE_PRICING.mature, ...e.mature },
    };
  }

  const $set = {
    cityId,
    phase: newPhase,
    phaseOverride: true,
    phaseChangedAt: now,
    updatedAt: now,
    phasePricing: { growing: phasePricing.growing, mature: phasePricing.mature },
  };

  await db.collection('cityAdSettings').updateOne(
    { cityId },
    { $set, $unset: { slots: '', waitlist: '', transitionRules: '' }, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
}

module.exports = {
  VALID_PHASES,
  DEFAULT_OPEN_REGION_PHASE_PRICING,
  getMatureUserThreshold,
  getCityPhase,
  countUsersInRegion,
  resolvePhaseForUserCount,
  computeOpenPhaseForCity,
  openAdvertisingForRegion,
  syncRegionAdPhasesFromUserCounts,
  setPhaseOverride,
  migrateLegacyCityAdSettingsShape,
};
