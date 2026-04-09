const { getDb } = require('../database');

/**
 * Maps placement strings to pricing keys.
 * featured_home → featured, inline_listing → sponsored
 */
const PLACEMENT_TO_PRICE_KEY = {
  featured_home: 'featured',
  inline_listing: 'sponsored',
  event_spotlight_7d: 'event_7d',
  event_spotlight_14d: 'event_14d',
};

/** Earliest calendar day (inclusive) for paid campaign start = today + this many days. */
const AD_CAMPAIGN_START_MIN_LEAD_DAYS = 2;
/** Latest calendar day (inclusive) for paid campaign start = today + this many days. */
const AD_CAMPAIGN_START_MAX_LEAD_DAYS = 30;

/**
 * Event spotlight prices are derived from monthly **sponsored** rate, then rounded up to whole dollars
 * with minimums so short runs do not look like odd leftover cents.
 * @param {number} monthlySponsoredCents
 * @param {'event_spotlight_7d'|'event_spotlight_14d'} placement
 */
function roundEventSpotlightPriceFromMonthlyCents(monthlySponsoredCents, placement) {
  const fraction = placement === 'event_spotlight_7d' ? 0.25 : 0.5;
  const raw = monthlySponsoredCents * fraction;
  let cents = Math.ceil(raw / 100) * 100;
  if (placement === 'event_spotlight_7d') cents = Math.max(1200, cents);
  if (placement === 'event_spotlight_14d') cents = Math.max(2200, cents);
  return cents;
}

/**
 * Gets the current price for a package in a city based on its phase.
 *
 * @param {string} cityId — regionKey (e.g. "omaha-ne")
 * @param {string} placement — 'featured_home' | 'inline_listing' | event_spotlight_*
 * @returns {Promise<{priceInCents: number, isIntroPrice: boolean, standardPriceInCents: number, introDurationMonths: number}>}
 */
async function getPhasePrice(cityId, placement) {
  const db = getDb();
  const settings = await db.collection('cityAdSettings').findOne({ cityId });

  if (!settings || !settings.phasePricing) {
    throw new Error(`No pricing configuration found for city: ${cityId}`);
  }

  let phase = settings.phase || 'seeding';
  if (phase === 'beta') phase = 'growth';

  const priceKey = PLACEMENT_TO_PRICE_KEY[placement] || placement;

  if (phase === 'seeding') {
    throw new Error(`Pricing not available for seeding-phase city: ${cityId}`);
  }

  const EVENT_DEFAULTS = { event_7d: 5000, event_14d: 9000 };

  let currentPhasePrice = settings.phasePricing[phase]?.[priceKey]
    ?? settings.phasePricing.growth?.[priceKey]
    ?? EVENT_DEFAULTS[priceKey]
    ?? null;
  if (currentPhasePrice == null) {
    throw new Error(`No ${priceKey} price configured for phase ${phase} in city ${cityId}`);
  }

  const isEventPackage = placement.startsWith('event_spotlight');
  if (isEventPackage) {
    const sponsoredMonthly = settings.phasePricing[phase]?.sponsored
      ?? settings.phasePricing.growth?.sponsored
      ?? null;
    const featuredMonthly = settings.phasePricing[phase]?.featured
      ?? settings.phasePricing.growth?.featured
      ?? null;
    const monthlyRef = sponsoredMonthly ?? featuredMonthly ?? null;
    if (monthlyRef != null) {
      if (placement === 'event_spotlight_7d' || placement === 'event_spotlight_14d') {
        currentPhasePrice = roundEventSpotlightPriceFromMonthlyCents(monthlyRef, placement);
      }
    }
    return {
      priceInCents: currentPhasePrice,
      isIntroPrice: false,
      standardPriceInCents: currentPhasePrice,
      introDurationMonths: 0,
    };
  }

  return {
    priceInCents: currentPhasePrice,
    isIntroPrice: false,
    standardPriceInCents: currentPhasePrice,
    introDurationMonths: 0,
  };
}

// --- Multi-month duration pricing ---

const DURATION_DISCOUNTS = {
  1: 0,
  2: 0.05,
  3: 0.15,
  6: 0.25,
};

const VALID_DURATIONS = [1, 2, 3, 6];

/**
 * Computes the total price for a multi-month campaign with duration discounts.
 *
 * @param {number} monthlyRateInCents - base monthly price from phase pricing
 * @param {number} durationMonths - 1, 2, 3, or 6
 * @param {number} [radiusSurchargeInCents=0] - one-time radius surcharge
 * @returns {{ totalPriceInCents: number, discountPercent: number, perMonthRateInCents: number, subtotalBeforeDiscount: number, discountAmountInCents: number }}
 */
function calculateMultiMonthPrice(monthlyRateInCents, durationMonths, radiusSurchargeInCents = 0) {
  if (!VALID_DURATIONS.includes(durationMonths)) {
    throw new Error(`Invalid duration: ${durationMonths}. Must be one of ${VALID_DURATIONS}`);
  }

  const discountPercent = DURATION_DISCOUNTS[durationMonths];
  const subtotalBeforeDiscount = durationMonths * monthlyRateInCents;
  const discountAmount = Math.round(subtotalBeforeDiscount * discountPercent);
  const subtotalAfterDiscount = subtotalBeforeDiscount - discountAmount;
  const totalPriceInCents = subtotalAfterDiscount + radiusSurchargeInCents;

  return {
    totalPriceInCents,
    discountPercent: Math.round(discountPercent * 100),
    perMonthRateInCents: Math.round(subtotalAfterDiscount / durationMonths),
    subtotalBeforeDiscount,
    discountAmountInCents: discountAmount,
  };
}

/**
 * Validates a start date string for ad campaigns (YYYY-MM-DD calendar date, no timezone shift).
 * Accepts dates from today + AD_CAMPAIGN_START_MIN_LEAD_DAYS through today + AD_CAMPAIGN_START_MAX_LEAD_DAYS (server local calendar).
 *
 * @param {string} startDateStr - ISO date string
 * @returns {{ valid: boolean, startDate: Date|null, error: string|null }}
 */
function validateStartDate(startDateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startDateStr || '').trim());
  if (!m) {
    return { valid: false, startDate: null, error: 'Invalid date format' };
  }
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const startDate = new Date(y, mo - 1, day);
  if (
    startDate.getFullYear() !== y ||
    startDate.getMonth() !== mo - 1 ||
    startDate.getDate() !== day
  ) {
    return { valid: false, startDate: null, error: 'Invalid calendar date' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() + AD_CAMPAIGN_START_MIN_LEAD_DAYS);

  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + AD_CAMPAIGN_START_MAX_LEAD_DAYS);

  startDate.setHours(0, 0, 0, 0);

  if (startDate < minDate) {
    return {
      valid: false,
      startDate: null,
      error: 'Start date must be at least 2 days from today',
    };
  }
  if (startDate > maxDate) {
    return {
      valid: false,
      startDate: null,
      error: 'Start date cannot be more than 30 days from today',
    };
  }

  return { valid: true, startDate, error: null };
}

module.exports = {
  PLACEMENT_TO_PRICE_KEY,
  AD_CAMPAIGN_START_MIN_LEAD_DAYS,
  AD_CAMPAIGN_START_MAX_LEAD_DAYS,
  DURATION_DISCOUNTS,
  VALID_DURATIONS,
  getPhasePrice,
  roundEventSpotlightPriceFromMonthlyCents,
  calculateMultiMonthPrice,
  validateStartDate,
};
