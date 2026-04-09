function getKidPlaceFilterConfig() {
  return {
    bannedTypes: new Set([
      // Adult / unrelated
      "bar",
      "night_club",
      "liquor_store",
      "casino",
      "lodging",
      "hotel",
      "motel",
      "resort",
      "hospital",
      "doctor",
      "dentist",
      "pharmacy",
      "physiotherapist",
      "funeral_home",
      // Schools — secondary/high/university banned; elementary handled via kidSignalKeywords
      "secondary_school",
      "high_school",
      "university",
      "college",
      // Government / admin / services
      "local_government_office",
      "courthouse",
      "police",
      "fire_station",
      "embassy",
      "post_office",
      // Commerce that tends to be false positives
      "bank",
      "atm",
      "car_dealer",
      "car_rental",
      "car_repair",
      "gas_station",
      "store",
      "shopping_mall",
      "department_store",
      "supermarket",
      "grocery_or_supermarket",
    ]),
    bannedNameKeywords: [
      "dmv",
      "department of motor vehicles",
      "treasury",
      "courthouse",
      "county clerk",
      "city hall",
      "hospital",
      "clinic",
      "urgent care",
      "emergency",
      " er",
      "police",
      "sheriff",
      "fire department",
      "hotel",
      "motel",
      "inn",
      "resort",
      "bank",
      "credit union",
      // Private/religious/charter schools — public elementary schools only
      "academy",
      "christian school",
      "christian academy",
      "catholic school",
      "catholic academy",
      "st. ",
      "saint ",
      "prep school",
      "preparatory",
      "montessori",
      "waldorf",
      "private school",
      "lutheran",
      "baptist",
      "episcopal",
      "hebrew",
      "jewish day",
      "charter school",
      "parochial",
      "college",
      "community college",
      "technical college",
      "tech college",
      "vocational",
      "trade school",
      // Law / academic libraries — not kid-friendly public libraries
      "law library",
      "legal research",
      "law school",
      "school of law",
      "college of law",
      "bar association",
    ],
    kidSignalTypes: new Set([
      "park",
      "amusement_park",
      /** Family fun centers; often missing from amusement_park + "kids" searches */
      "amusement_center",
      /** Google type for mini-golf / putt-putt; frequently absent from types[] even when keyword-matched */
      "mini_golf",
      "library",
      "public_library",
      "local_library",
      "museum",
      "children_museum",
      "zoo",
      "aquarium",
      "arcade",
      "amusement_arcade",
      "tourist_attraction",
      "campground",
      "primary_school",  // elementary schools have playgrounds
      "school",          // generic school — filtered further by name keywords below
      "bowling_alley",
      "swimming_pool",
      "natural_feature",
    ]),
    kidSignalKeywords: [
      "playground",
      "kids",
      "kid's",
      "children",
      "children's",
      "family fun",
      "trampoline",
      "indoor play",
      "play place",
      "children museum",
      "science center",
      "science museum",
      "elementary",
      "elementary school",
      "primary school",
      "arcade",
      "skating rink",
      "ice rink",
      "skate park",
      "botanical garden",
      "zoo exhibit",
      "animal exhibit",
      "exhibit",
      "habitat",
      "aviary",
      "jungle",
      "desert dome",
      "aquarium",
      "gorilla",
      "elephant",
      "carousel",
      "water park",
      "fun park",
      "splash pad",
      "swimming pool",
      "beach",
      "pottery",
      "paint your own",
      "art studio",
      "mini golf",
      "putt putt",
      "miniature golf",
      /** Short tokens: use with name + vicinity only (Nearby Search has no long description). */
      "putt",
      "amusement",
    ],
  };
}

/**
 * Hyphens in brand names (e.g. Putt-Putt) break substring checks like "putt putt".
 */
function nameForKidKeywordMatch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Google Nearby returns `name` + optional `vicinity` — no editorial description until Place Details. */
function kidKeywordHaystack(place) {
  const parts = [place?.name, place?.vicinity].filter((x) => x && String(x).trim());
  return nameForKidKeywordMatch(parts.join(" "));
}

/**
 * @returns {{ ok: boolean, reasons: string[] }}
 */
function evaluateKidFriendlySeedCandidate(place) {
  const reasons = [];
  if (place == null || typeof place !== 'object') {
    return { ok: false, reasons: ['missing or invalid place object'] };
  }

  const cfg = getKidPlaceFilterConfig();
  const nameLower = String(place?.name || '').toLowerCase();
  const textKidKw = kidKeywordHaystack(place);
  const types = Array.isArray(place?.types) ? place.types : [];
  const typesLower = types.map((t) => String(t).toLowerCase());

  const bannedTypeTokens = Array.from(cfg.bannedTypes);
  const kidTypeTokens = Array.from(cfg.kidSignalTypes);

  for (const t of typesLower) {
    for (const token of bannedTypeTokens) {
      if (t.includes(token)) {
        reasons.push(`banned type: Google type "${t}" matches banned token "${token}"`);
        return { ok: false, reasons };
      }
    }
  }

  for (const kw of cfg.bannedNameKeywords) {
    if (nameLower.includes(kw)) {
      reasons.push(`banned name keyword: "${kw}"`);
      return { ok: false, reasons };
    }
  }

  const isSchoolType = typesLower.some((t) => t.includes('school') || t.includes('primary_school'));
  if (isSchoolType) {
    const elementarySignals = ['elementary', 'primary', 'kindergarten', 'k-5', 'k-6', 'k-8'];
    const isElementary = elementarySignals.some((kw) => nameLower.includes(kw));
    if (!isElementary) {
      reasons.push('school-type place without elementary/primary signals in name');
      return { ok: false, reasons };
    }
  }

  const hasKidType = typesLower.some((t) => kidTypeTokens.some((token) => t.includes(token)));
  const hasKidKeyword = cfg.kidSignalKeywords.some((kw) => textKidKw.includes(kw));
  if (!hasKidType && !hasKidKeyword) {
    reasons.push(
      'no kid signal: types do not match kid allowlist (substring) and name+vicinity lack kid keywords',
    );
    return { ok: false, reasons };
  }

  return { ok: true, reasons: [] };
}

function isKidFriendlySeedCandidate(place) {
  return evaluateKidFriendlySeedCandidate(place).ok;
}

module.exports = {
  getKidPlaceFilterConfig,
  isKidFriendlySeedCandidate,
  evaluateKidFriendlySeedCandidate,
};
