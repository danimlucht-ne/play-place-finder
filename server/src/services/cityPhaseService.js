const { getDb } = require('../database');
const { regionKeyCandidates } = require('../utils/regionKeyForAds');

/**
 * City ad phases (stored in `cityAdSettings`, keyed by regionKey as cityId).
 * Independent of map `seeded_regions.seedStatus` (Places/scrub pipeline).
 *
 * - **seeding** — default when no `cityAdSettings` row exists. House ads only; slot checks block advertisers.
 * - **Leaving seeding** — First advertiser completing ad signup bootstraps `cityAdSettings` to **growth**
 *   (`adSubmissionRoutes`), or admin **Open advertising** / **PUT …/cities/:id/phase** (`adAdminRoutes`).
 * - **growth → mature** — `evaluateAllCityTransitions()` after lifecycle work; skipped when `phaseOverride` is true.
 *
 * Legacy documents may still have `phase: 'beta'`; the lifecycle job migrates them to **growth** on the next run.
 */
const PHASE_SLOT_LIMITS = {
  growth: { featured: 1, sponsored: 5 },
  mature: { featured: 1, sponsored: 8 },
};

/**
 * Maps placement strings to slot keys.
 * featured_home → featured, inline_listing → sponsored
 */
const PLACEMENT_TO_SLOT = {
  featured_home: 'featured',
  inline_listing: 'sponsored',
};

const VALID_PHASES = ['seeding', 'growth', 'mature'];

/**
 * Gets the current phase and slot availability for a city.
 * @param {string} cityId — regionKey
 * @returns {Promise<{phase: string, slotsRemaining: {featured: number, sponsored: number}, pricing: Object|null}>}
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
      slotsRemaining: { featured: 0, sponsored: 0 },
      pricing: null,
    };
  }

  let phase = settings.phase || 'seeding';
  if (phase === 'beta') phase = 'growth';

  const slotsRemaining = {
    featured: settings.slots?.featured?.remaining ?? 0,
    sponsored: settings.slots?.sponsored?.remaining ?? 0,
  };

  const pricing = phase === 'seeding'
    ? null
    : settings.phasePricing?.[phase] ?? settings.phasePricing?.growth ?? null;

  return { phase, slotsRemaining, pricing };
}

/** Once a city is past seeding, we do not block new advertisers on slot counters (inventory is informational). */
function isCityOpenForAdvertisers(phase) {
  const p = phase === 'beta' ? 'growth' : phase;
  return p === 'growth' || p === 'mature';
}

/**
 * Checks if a specific slot type is available in a city.
 * @param {string} cityId — regionKey
 * @param {string} placement — 'featured_home' | 'inline_listing'
 * @returns {Promise<{available: boolean, remaining: number}>}
 */
async function checkSlotAvailability(cityId, placement) {
  const db = getDb();
  const settings = await db.collection('cityAdSettings').findOne({ cityId });

  if (!settings) {
    return { available: false, remaining: 0 };
  }

  const slotKey = PLACEMENT_TO_SLOT[placement] || placement;
  const remaining = settings.slots?.[slotKey]?.remaining ?? 0;

  let phase = settings.phase;
  if (phase === 'beta') phase = 'growth';

  if (phase === 'seeding') {
    return { available: false, remaining: 0 };
  }
  if ((phase === undefined || phase === null) && !settings.slots) {
    return { available: false, remaining: 0 };
  }

  if (isCityOpenForAdvertisers(phase)) {
    return { available: true, remaining };
  }

  return {
    available: remaining > 0,
    remaining,
  };
}

/**
 * Decrements available slots when a campaign is activated.
 * Uses atomic findOneAndUpdate with remaining > 0 filter to prevent negative inventory.
 * @param {string} cityId — regionKey
 * @param {string} placement — 'featured_home' | 'inline_listing' or slot key 'featured' | 'sponsored'
 * @returns {Promise<void>}
 */
async function decrementSlot(cityId, placement) {
  const db = getDb();
  const slotKey = PLACEMENT_TO_SLOT[placement] || placement;
  const remainingPath = `slots.${slotKey}.remaining`;

  const result = await db.collection('cityAdSettings').findOneAndUpdate(
    {
      cityId,
      [remainingPath]: { $gt: 0 },
    },
    {
      $inc: { [remainingPath]: -1 },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: 'after' }
  );

  if (!result) {
    console.warn(`[slots] No ${slotKey} slot counter to decrement for ${cityId} (remaining was 0); allowing campaign activation.`);
  }
}

/**
 * Increments available slots when a campaign completes or is cancelled.
 * Ensures remaining does not exceed max.
 * @param {string} cityId — regionKey
 * @param {string} placement — 'featured_home' | 'inline_listing' or slot key 'featured' | 'sponsored'
 * @returns {Promise<void>}
 */
async function incrementSlot(cityId, placement) {
  const db = getDb();
  const slotKey = PLACEMENT_TO_SLOT[placement] || placement;
  const remainingPath = `slots.${slotKey}.remaining`;
  const maxPath = `slots.${slotKey}.max`;

  await db.collection('cityAdSettings').findOneAndUpdate(
    {
      cityId,
      $expr: { $lt: [`$${remainingPath}`, `$${maxPath}`] },
    },
    {
      $inc: { [remainingPath]: 1 },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: 'after' }
  );
}

/**
 * Migrates legacy `beta` cityAdSettings rows to `growth` with growth slot limits and pricing keys.
 */
async function migrateLegacyBetaCities(now = new Date()) {
  const db = getDb();
  const rows = await db.collection('cityAdSettings').find({ phase: 'beta' }).toArray();
  for (const city of rows) {
    const growthLimits = PHASE_SLOT_LIMITS.growth;
    const activeFeatured = await db.collection('adCampaigns').countDocuments({
      cityId: city.cityId,
      placement: 'featured_home',
      status: 'active',
    });
    const activeSponsored = await db.collection('adCampaigns').countDocuments({
      cityId: city.cityId,
      placement: 'inline_listing',
      status: 'active',
    });
    const pp = { ...(city.phasePricing || {}) };
    if (!pp.growth && pp.beta) pp.growth = { ...pp.beta };
    delete pp.beta;
    await db.collection('cityAdSettings').updateOne(
      { _id: city._id },
      {
        $set: {
          phase: 'growth',
          phasePricing: pp,
          phaseChangedAt: now,
          'slots.featured.max': growthLimits.featured,
          'slots.featured.remaining': Math.max(0, growthLimits.featured - activeFeatured),
          'slots.sponsored.max': growthLimits.sponsored,
          'slots.sponsored.remaining': Math.max(0, growthLimits.sponsored - activeSponsored),
          transitionRules: {
            growthToMature: city.transitionRules?.growthToMature || { allSlotsFilled: true, hasWaitlist: false },
          },
          updatedAt: now,
        },
      },
    );
  }
}

/**
 * Evaluates phase transition triggers for all cities.
 * Called by the periodic lifecycle job.
 * - Migrates any legacy `beta` rows to `growth`
 * - Growth → Mature: all slots filled OR waitlist has entries
 * Skips seeding cities and cities with phaseOverride: true.
 * @returns {Promise<{transitioned: string[]}>}
 */
async function evaluateAllCityTransitions() {
  const db = getDb();
  const now = new Date();
  const transitioned = [];

  await migrateLegacyBetaCities(now);

  const cities = await db.collection('cityAdSettings')
    .find({ phase: 'growth', phaseOverride: { $ne: true } })
    .toArray();

  for (const city of cities) {
    const activeCount = await db.collection('adCampaigns').countDocuments({
      cityId: city.cityId,
      status: 'active',
    });

    let newPhase = null;

    const allFilled = city.slots?.featured?.remaining === 0
      && city.slots?.sponsored?.remaining === 0;
    const hasWaitlist = city.waitlist && city.waitlist.length > 0;

    if (allFilled || hasWaitlist) {
      newPhase = 'mature';
    }

    if (newPhase) {
      const newSlotLimits = PHASE_SLOT_LIMITS[newPhase];

      const activeFeatured = await db.collection('adCampaigns').countDocuments({
        cityId: city.cityId,
        placement: 'featured_home',
        status: 'active',
      });
      const activeSponsored = await db.collection('adCampaigns').countDocuments({
        cityId: city.cityId,
        placement: 'inline_listing',
        status: 'active',
      });

      await db.collection('cityAdSettings').updateOne(
        { _id: city._id },
        {
          $set: {
            phase: newPhase,
            phaseChangedAt: now,
            'slots.featured.max': newSlotLimits.featured,
            'slots.featured.remaining': Math.max(0, newSlotLimits.featured - activeFeatured),
            'slots.sponsored.max': newSlotLimits.sponsored,
            'slots.sponsored.remaining': Math.max(0, newSlotLimits.sponsored - activeSponsored),
            updatedAt: now,
          },
        }
      );

      transitioned.push(`${city.cityId}: ${city.phase}→${newPhase}`);
    }
  }

  return { transitioned };
}

/**
 * Manually sets a city's phase (admin override).
 * Sets phaseOverride to true so automated transitions skip this city.
 * @param {string} cityId — regionKey
 * @param {string} newPhase — one of 'seeding', 'growth', 'mature'
 * @returns {Promise<void>}
 */
async function setPhaseOverride(cityId, newPhase) {
  if (!VALID_PHASES.includes(newPhase)) {
    throw new Error(`Invalid phase: ${newPhase}. Must be one of: ${VALID_PHASES.join(', ')}`);
  }

  const db = getDb();
  const now = new Date();

  await db.collection('cityAdSettings').updateOne(
    { cityId },
    {
      $set: {
        phase: newPhase,
        phaseOverride: true,
        phaseChangedAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

module.exports = {
  PHASE_SLOT_LIMITS,
  PLACEMENT_TO_SLOT,
  VALID_PHASES,
  getCityPhase,
  checkSlotAvailability,
  decrementSlot,
  incrementSlot,
  evaluateAllCityTransitions,
  setPhaseOverride,
  migrateLegacyBetaCities,
};
