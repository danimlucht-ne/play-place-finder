/**
 * Deterministic pre-filter for seed location scrub before Gemini.
 *
 * decision:
 * - accept  → treat as valid play place (skip LLM)
 * - reject  → not a play place (skip LLM)
 * - llm     → needs Gemini batch validation
 *
 * Keep conservative: when unsure, return llm.
 */

const REJECT_TYPE_SUBSTRINGS = [
  'lodging',
  'hotel',
  'hospital',
  'doctor',
  'physician',
  'dentist',
  'supermarket',
  'grocery_or_supermarket',
  'convenience_store',
  'bank',
  'atm',
  'night_club',
  'bar',
  'liquor_store',
  'casino',
  'cemetery',
  'funeral_home',
  'car_dealer',
  'real_estate_agency',
];

const REJECT_NAME_RES = [
  /\bhotel\b/i,
  /\bmotel\b/i,
  /\bresort\b/i,
  /\bhospital\b/i,
  /\bclinic\b/i,
  /\burgent\s*care\b/i,
  /\b(?:walmart|target|costco|kroger|safeway|whole\s*foods)\b/i,
  /\b(?:bank|credit\s*union)\b/i,
];

const ACCEPT_TYPE_SUBSTRINGS = [
  'park',
  'playground',
  'amusement_center',
  'zoo',
  'aquarium',
  'museum',
  'library',
  'tourist_attraction',
  'bowling_alley',
  'amusement_park',
  'skate_park',
  'mini_golf',
  'swimming_pool',
];

/**
 * @param {{ id?: string, name?: string, types?: string[] }} place
 * @returns {{ decision: 'accept' | 'reject' | 'llm' }}
 */
function classifyPlaceForValidation(place) {
  const types = (place.types || []).map((t) => String(t).toLowerCase());
  const name = String(place.name || '');

  for (const t of types) {
    if (REJECT_TYPE_SUBSTRINGS.some((s) => t.includes(s))) {
      return { decision: 'reject' };
    }
  }
  for (const re of REJECT_NAME_RES) {
    if (re.test(name)) {
      return { decision: 'reject' };
    }
  }

  for (const t of types) {
    if (ACCEPT_TYPE_SUBSTRINGS.some((s) => t.includes(s))) {
      return { decision: 'accept' };
    }
  }

  return { decision: 'llm' };
}

module.exports = { classifyPlaceForValidation };
