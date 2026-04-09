/**
 * Infer app `playgroundType` from Google Places `types[]` + place name.
 * Strings MUST match Android CategoryTypePicker (PLACE_CATEGORIES) and AmenityTypeMapping.TYPE_GROUP_MAP.
 *
 * Priority: specific venue signals first; broad "Public Park" / generic fallbacks last.
 */

/** Spray / splash-first: must run before pool-style names that mention "aquatic". */
const SPLASH_NAME_RE =
    /splash\s*pad|splash\s*park|spray\s*park|spray\s*ground|sprayground|splash\s*zone/i;

/**
 * Pools & large aquatics — includes phrases Google often omits from `types`
 * (e.g. name-only "Swimming Pool", "Natatorium", "Aquatic Center").
 */
const POOL_OR_WATER_NAME_RE =
    /swimming\s*pool|swim\s*pool|community\s*pool|municipal\s*pool(\s*#?\d+)?|public\s*pool|outdoor\s*pool|indoor\s*pool|wading\s*pool|lap\s*pool|leisure\s*pool|teaching\s*pool|natatorium|aquatic\s*center|aquatic\s*centre|family\s*aquatic|water\s*park|waterpark|aqua\s*(park|center|centre)|\baquatic\b.*\b(pool|park|center|centre)\b|\bpool\b.*\b(rec|recreation|center|centre|family)\b|diving\s*(well|pool)|competition\s*pool|ymca.*\bpool\b|\by\s*m\s*c\s*a\b.*\baquatic/i;

const MINI_GOLF_NAME_RE = /mini\s*golf|miniature\s*golf|putt[\s-]*putt|putting\s*course/i;

const BEACH_NAME_RE = /\bbeach\b|\bshore\b|oceanfront|lakeside\s*beach|swim\s*beach/i;

function inferPlaygroundType(types, name) {
    const typesLower = (types || []).map((t) => String(t).toLowerCase());
    const nameLower = String(name || '').toLowerCase();

    // ── Schools / learning ─────────────────────────────────────────────
    if (typesLower.some((t) => t.includes('school') || t === 'primary_school')) {
        return 'Elementary School';
    }
    if (typesLower.some((t) => t.includes('library'))) {
        return 'Library';
    }
    if (
        typesLower.some((t) => t.includes('museum')) ||
        /science\s*center|children'?s\s*museum|kids\s*museum/.test(nameLower)
    ) {
        return 'Museum / Science Center';
    }
    if (
        typesLower.includes('zoo') ||
        typesLower.includes('aquarium') ||
        typesLower.includes('wildlife_park') ||
        /zoo|aquarium|wildlife|safari/.test(nameLower)
    ) {
        return 'Zoo / Aquarium';
    }

    // ── Active / entertainment (typed + name) ───────────────────────────
    if (typesLower.includes('bowling_alley') || /bowling/.test(nameLower)) {
        return 'Bowling Alley';
    }

    // Splash / spray before generic pool — avoids classifying splash pads as pools only.
    if (SPLASH_NAME_RE.test(nameLower)) {
        return 'Splash Pad';
    }

    if (
        typesLower.includes('swimming_pool') ||
        POOL_OR_WATER_NAME_RE.test(nameLower)
    ) {
        return 'Pool / Water Park';
    }

    // Skatepark vs ice vs roller: Google uses skate_park; names often say "skate park".
    if (typesLower.includes('skate_park') || /\bskate\s*park\b|skateboard\s*park/.test(nameLower)) {
        return 'Skate Park';
    }
    if (/\broller\s*rink\b|\broller\s*skating\b/.test(nameLower)) {
        return 'Indoor Play';
    }
    if (
        /\bice\s*rink\b|hockey\s*rink|curling\s*rink|\bfigure\s*skating\b|\bskating\s*rink\b/.test(nameLower) ||
        typesLower.includes('ice_skating_rink') ||
        typesLower.includes('skating_rink')
    ) {
        return 'Ice Skating Rink';
    }

    if (MINI_GOLF_NAME_RE.test(nameLower) || typesLower.includes('mini_golf')) {
        return 'Mini Golf';
    }

    if (
        typesLower.some((t) => t.includes('arcade') || t.includes('amusement_arcade')) ||
        /arcade|beercade|brewcade/.test(nameLower)
    ) {
        return 'Arcade';
    }

    if (typesLower.includes('amusement_park')) {
        return 'Amusement Park';
    }

    // Indoor play — avoid bare "indoor" early (e.g. "indoor pool") so pool wins via POOL_OR_WATER_NAME_RE;
    // still catch trampoline / branded chains.
    if (
        /trampoline|bounce|boing|sky\s*zone|urban\s*air|altitude|jump\s*city|defy\b/.test(nameLower) ||
        typesLower.includes('indoor_playground')
    ) {
        return 'Indoor Play';
    }
    if (/indoor\s*play|play\s*place|fun\s*zone|play\s*zone|kids\s*zone/i.test(nameLower)) {
        return 'Indoor Play';
    }
    // "Adventure park" indoor-style (not amusement_park type)
    if (/indoor\s*adventure|discovery\s*zone|play\s*cafe/i.test(nameLower)) {
        return 'Indoor Play';
    }

    // ── Outdoors / nature ─────────────────────────────────────────────────
    if (typesLower.includes('beach') || BEACH_NAME_RE.test(nameLower)) {
        return 'Beach';
    }

    if (
        typesLower.includes('botanical_garden') ||
        /botanical\s*garden|arboretum/.test(nameLower)
    ) {
        return 'Botanical Garden';
    }

    if (
        typesLower.includes('campground') ||
        /nature\s*trail|walking\s*trail|hiking\s*trail|greenway|nature\s*preserve|state\s*forest\b/i.test(
            nameLower
        ) ||
        typesLower.includes('natural_feature') ||
        (typesLower.includes('park') && /trail|greenway|preserve|wildlife refuge/i.test(nameLower))
    ) {
        // Beaches sometimes carry natural_feature; BEACH_NAME_RE handled above.
        return 'Nature Trail';
    }

    // Neighborhood / small parks
    if (
        /neighborhood|community\s*park|subdivision|hoa|homeowner|cul\.?\s*de\s*sac|pocket\s*park|tot\s*lot/.test(
            nameLower
        ) ||
        typesLower.includes('neighborhood')
    ) {
        return 'Neighborhood Park';
    }

    // Municipal / large named parks (app buckets these as Public Park today)
    if (
        /city\s*park|municipal|county\s*park|regional\s*park|state\s*park|metro\s*park|memorial\s*park|veterans?\s*park/.test(
            nameLower
        )
    ) {
        return 'Public Park';
    }

    if (/playground|play\s*area|play\s*ground/.test(nameLower)) {
        return 'Playground';
    }

    if (typesLower.includes('park') || typesLower.includes('tourist_attraction')) {
        return 'Public Park';
    }

    // Weaker fallback: seeded / hybrid results are usually kid-adjacent POIs.
    return 'Public Park';
}

module.exports = { inferPlaygroundType, SPLASH_NAME_RE, POOL_OR_WATER_NAME_RE };
