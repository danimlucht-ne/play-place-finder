// services/venueMergeService.js
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const { ACTIVE_PLAYGROUND_FILTER } = require('./activePlaygroundFilter');

/**
 * Live playgrounds that belong to a metro for campus / park / address merge + proximity dedup.
 * Matches GET /by-region semantics: primary `regionKey` OR listed under `coveredRegionKeys`.
 * Without this, venues only cross-listed under an umbrella never enter `detectAndGroupSubVenues`.
 */
function playgroundsInMergeRegion(regionKey) {
  return {
    ...ACTIVE_PLAYGROUND_FILTER,
    $or: [{ regionKey }, { coveredRegionKeys: regionKey }],
  };
}

// ─── Boolean amenity fields (OR merge) ───────────────────────────────────────
const BOOL_FIELDS = [
  'hasBathrooms', 'hasShade', 'isFenced', 'isToddlerFriendly',
  'hasSplashPad', 'hasSkatePark', 'isDogFriendly', 'hasParking', 'hasWifi',
  'hasBenches', 'hasPicnicTables', 'hasTrashCans', 'isAccessible',
  'hasWalkingTrail', 'hasBottleFiller', 'needsGripSocks', 'requiresWaiver',
];

// ─── Array fields (union merge, deduplicated) ────────────────────────────────
const ARRAY_FIELDS = [
  'imageUrls', 'equipment', 'swingTypes', 'sportsCourts',
  'exerciseEquipment', 'badges', 'types',
];

// ─── Generic name suffixes that indicate a "parent-level" venue name ─────────
const GENERIC_SUFFIXES = ['park', 'center', 'complex', 'recreation', 'facility', 'zoo', 'aquarium', 'museum'];
const PARENT_VENUE_TERMS = /\b(park|zoo|aquarium|museum|science\s+center|sports\s+complex|athletic\s+complex|recreation\s+(area|center|centre)|nature\s+center|botanical\s+garden|amusement\s+park)\b/i;
const CHILD_AMENITY_TERMS = /\b(splash\s*pad|splash\s*park|spray\s*ground|sprayground|playground|soccer\s*fields?|baseball\s*fields?|softball\s*fields?|football\s*fields?|field\s*\d*|court|courts|trail|trailhead|walking\s*trail|bike\s*trail|pavilion|picnic|shelter|dog\s*park|skate\s*park|mini\s+park|exhibit|habitat|jungle|dome|aviary|kingdom|carousel|garden|lake|pond)\b/i;
const PARK_PARENT_TYPES = new Set(['park', 'campground', 'natural_feature']);
const PARK_CHILD_TYPES = new Set([
  'park',
  'tourist_attraction',
  'point_of_interest',
  'establishment',
  'stadium',
  'amusement_park',
]);

const PLACEHOLDER_IMAGE_NAME_RE = /(?:public|neighborhood|private|nature|splash|beach|botanical|indoor|water|skate|ice|mini|amusement|library|museum|zoo|school|elementary)[-_](?:playground|park|play|trail|pad|garden|pool|placeholder)/i;

function isDefaultPlaceholderImageUrl(url) {
  const s = String(url || '').trim();
  if (!s) return false;
  if (/^android\.resource:\/\//i.test(s)) return true;
  return PLACEHOLDER_IMAGE_NAME_RE.test(s);
}

// ─── Task 1.1: extractNamePrefix ─────────────────────────────────────────────
/**
 * Strips leading noise so "Omaha's Henry Doorly Zoo" clusters with "Henry Doorly Zoo — Exhibit".
 * @param {string} name
 * @returns {string}
 */
function stripVenueNoise(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .trim()
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/^omaha'?s\s+/i, '')
    .trim();
}

/**
 * Returns the first two words of a name (after noise strip), lowercased.
 * Returns null if the name has fewer than two words.
 * @param {string} name
 * @returns {string|null}
 */
function extractNamePrefix(name) {
  if (!name || typeof name !== 'string') return null;
  const cleaned = stripVenueNoise(name);
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 2) return null;
  return words.slice(0, 2).join(' ').toLowerCase();
}

// ─── Task 1.2: longestCommonPrefix ───────────────────────────────────────────
/**
 * Returns the longest word-boundary prefix shared by all names.
 * Returns null if fewer than two common words.
 * @param {string[]} names
 * @returns {string|null}
 */
function longestCommonPrefix(names) {
  if (!names || names.length === 0) return null;
  const wordArrays = names.map(n => n.trim().split(/\s+/));
  const minLen = Math.min(...wordArrays.map(w => w.length));
  const prefix = [];

  for (let i = 0; i < minLen; i++) {
    const word = wordArrays[0][i].toLowerCase();
    if (wordArrays.every(w => w[i].toLowerCase() === word)) {
      prefix.push(wordArrays[0][i]); // preserve original casing from first name
    } else {
      break;
    }
  }

  return prefix.length >= 2 ? prefix.join(' ') : null;
}

// ─── Campus / large-venue clustering (zoo, aquarium, museum) ────────────────
const CAMPUS_TOKEN_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'on', 'at', 'to', 'by', 'from',
  'park', 'center', 'centre', 'complex', 'facility', 'recreation', 'area', 'place',
  'omaha', 'nebraska', 'usa', 'us', 'ne',
]);

/** Google Places type strings that indicate a campus-scale anchor (zoo, museum, …). */
function hasStrongCampusGoogleType(place) {
  const types = (place.types || []).map((t) => String(t).toLowerCase());
  return types.some(
    (t) =>
      t === 'zoo'
      || t === 'aquarium'
      || t === 'museum'
      || t === 'art_gallery'
  );
}

/**
 * True if this place can seed a campus cluster (main gate / umbrella venue).
 * Includes Google-type-only rows (e.g. a POI named "Building A" with type zoo) — used for attachment checks and fallback seeding.
 */
function isCampusAnchorCandidate(place) {
  if (isZooAquariumSupportOrganizationName(place)) return false;
  if (isPrimaryCampusAnchor(place)) return true;
  if (!hasStrongCampusGoogleType(place)) return false;
  const types = (place.types || []).map((t) => String(t).toLowerCase());
  const n = (place.name || '').toLowerCase();
  // Google often tags exhibits with `zoo`; require the public title to say zoo/aquarium before campus candidacy.
  if (types.includes('zoo') || types.includes('aquarium')) {
    if (!/\bzoo\b/i.test(n) && !/\baquarium\b/i.test(n)) return false;
  }
  return true;
}

const CAMPUS_ROOT_NAME_WORDS = /\b(zoo|aquarium|museum|science\s+center|botanical\s+garden|arboretum|conservatory)\b/i;

/**
 * Google often titles exhibits "Desert Dome — Henry Doorly Zoo" or "Penguins at Omaha Zoo".
 * Those must NOT seed campus clusters (each would become a parent with its own location + subVenues).
 * True umbrella rows have zoo/museum/aquarium in the main title segment, not only in a subtitle.
 */
/**
 * Google often titles a themed land "Alaskan Adventure Henry Doorly Zoo" with type `zoo`, which makes
 * {@link isPrimaryCampusAnchor}/{@link isZooUmbrellaAnchor} true and lets it steal the campus parent from
 * the real gate row ("Omaha's Henry Doorly Zoo and Aquarium"). Those branded sub-areas are exhibits, not umbrellas.
 */
function nameSuggestsHenryDoorlyZooSubBrandNotMainGate(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim().toLowerCase();
  if (!/\bhenry\s+doorly\b/.test(n)) return false;
  if (/\b(zoo\s+and\s+aquarium|zoo\s*&\s*aquarium)\b/i.test(n)) return false;
  if (/^omaha'?s\s+henry\s+doorly\s+zoo\b/i.test(n)) return false;
  if (/^henry\s+doorly\s+zoo\s+and\s+aquarium\b/i.test(n)) return false;
  return /\b(alaskan|adventure|expedition|hubbard|lied|stingray|simmons|gorilla|asian|madagascar|orangutan|aviary|infield|scott)\b/i.test(
    n,
  );
}

function nameSuggestsCampusExhibitNotRoot(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();

  const atParts = lower.split(/\s+at\s+/);
  if (atParts.length >= 2) {
    const first = atParts[0];
    const last = atParts[atParts.length - 1];
    if (!CAMPUS_ROOT_NAME_WORDS.test(first) && CAMPUS_ROOT_NAME_WORDS.test(last)) return true;
  }

  const segments = trimmed.split(/\s*(?:[–—]|\||\s-\s)\s*/);
  if (segments.length >= 2) {
    const first = segments[0].toLowerCase();
    const rest = segments.slice(1).join(' ').toLowerCase();
    if (!CAMPUS_ROOT_NAME_WORDS.test(first) && CAMPUS_ROOT_NAME_WORDS.test(rest)) return true;
  }

  return false;
}

/**
 * Strict campus root: name or app classification says this is the venue itself, not just a Google type on an exhibit.
 * Prevents every on-grounds POI tagged `zoo` / `tourist_attraction` from becoming its own anchor (fixes fragmented zoo subvenues).
 */
function isPrimaryCampusAnchor(place) {
  const name = place.name || '';
  if (nameSuggestsCampusExhibitNotRoot(name)) return false;
  if (nameSuggestsHenryDoorlyZooSubBrandNotMainGate(name)) return false;
  if (hasFoodOrRetailGoogleType(place) || /\b(cafe|restaurant|snack|grill|gift\s+shop|store)\b/i.test(name)) return false;

  const types = (place.types || []).map((t) => String(t).toLowerCase());
  const lower = name.toLowerCase();
  // Support / fundraising rows are not the public zoo umbrella (e.g. "Omaha Zoo Foundation").
  if (/\b(foundation|friends\s+of|endowment|development\s+office)\b/i.test(lower)
    && /\b(zoo|aquarium)\b/i.test(lower)
    && !/\bzoo\s+and\s+aquarium\b/i.test(lower)) {
    return false;
  }
  // Google tags on-grounds buildings as aquarium+tourist only; without a zoo type / "zoo" in the title,
  // treat them as exhibits (not a second umbrella that refuses to merge with the main gate listing).
  if (types.includes('aquarium') && !types.includes('zoo') && !/\bzoo\b/i.test(lower)) {
    return false;
  }

  if (/\b(zoo|aquarium|museum|botanical\s+garden|arboretum|conservatory)\b/.test(lower)) return true;
  const pt = (place.playgroundType || '').toLowerCase();
  // App-inferred "Zoo / Aquarium" on on-grounds exhibits (plus Google `zoo` on buildings) must not make a row
  // a campus umbrella — otherwise "Lied Jungle" outscores real gate rows that carry Henry Doorly penalties.
  if (/(museum|science\s*center|botanical\s*garden|arboretum|conservatory)/.test(pt)) return true;
  return false;
}

function extractSignificantTokens(name) {
  const cleaned = stripVenueNoise(name || '');
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  const out = [];
  for (const w of words) {
    const lower = w.replace(/[^a-z0-9']/gi, '').toLowerCase();
    if (lower.length < 3 || CAMPUS_TOKEN_STOPWORDS.has(lower)) continue;
    out.push(lower);
  }
  return out;
}

/**
 * Fundraising / support listings that often carry Google `zoo` types but are not the public umbrella venue.
 * Kept separate from {@link isObviousNonCampusChild} so campus eligibility can reference it explicitly.
 */
function isZooAquariumSupportOrganizationName(place) {
  const n = String(place?.name || '').toLowerCase();
  if (!n) return false;
  if (/\b(zoo|aquarium)\s+foundation\b/.test(n)) return true;
  if (/\bfoundation\b/.test(n) && /\bzoo\b/.test(n) && !/\baquarium\b/.test(n)) return true;
  if (/\b(friends\s+of)\b/.test(n) && /\b(zoo|aquarium)\b/.test(n) && !/\b(garden|gardens|botanical)\b/.test(n)) {
    return true;
  }
  if (/\b(zoological\s+society)\b/.test(n) && /\b(omaha|henry|doorly)\b/.test(n)) return true;
  return false;
}

/** Blocks obvious non-exhibit POIs from being pulled into a campus cluster. */
function isObviousNonCampusChild(name) {
  if (!name || typeof name !== 'string') return true;
  const n = name.toLowerCase();
  if (isZooAquariumSupportOrganizationName({ name })) return true;
  return (
    /\b(mcdonald|burger king|subway|starbucks|walmart|target|costco|parking|parking\s+lot|garage|entrance|gate|gas station|motel|hotel|inn|elementary|middle\s+school|high\s+school|visit omaha|tourist info|information center|souvenir)\b/.test(
      n
    )
    || /\bpin\s*\(/.test(n)
    || /\bvisit\s+\w+\s+pin\b/.test(n)
  );
}

function hasFoodOrRetailGoogleType(place) {
  const types = (place.types || []).map((t) => String(t).toLowerCase());
  return types.some((t) =>
    /restaurant|cafe|meal_takeaway|fast_food|bar|lodging|gas_station|store|shopping_mall|supermarket/.test(t)
  );
}

/** Types that indicate an exhibit-like POI (not generic city parks or bare POI). */
function hasVisitorFacingGoogleType(place) {
  const types = (place.types || []).map((t) => String(t).toLowerCase());
  return types.some((t) =>
    /^(zoo|aquarium|museum|art_gallery|tourist_attraction|amusement_park)$/.test(t)
  );
}

/**
 * True when this row is the umbrella "zoo" campus (not a free-standing aquarium/museum/botanical garden).
 * Used to tighten which POIs may merge as sub-venues under the zoo (exhibits only — not adjacent rail museums or gardens).
 */
function isZooUmbrellaAnchor(place) {
  if (!isPrimaryCampusAnchor(place)) return false;
  const types = (place.types || []).map((t) => String(t).toLowerCase());
  if (types.includes('zoo')) return true;
  const n = (place.name || '').toLowerCase();
  return /\bzoo\b/.test(n);
}

/** Names / types we never want as Henry Doorly–style zoo sub-venues (separate attractions that share a campus fence line). */
function isZooCampusChildBlocklisted(child) {
  const n = (child.name || '').toLowerCase();
  const pt = (child.playgroundType || '').toLowerCase();
  const hay = `${n} ${pt}`;
  if (/\b(lauritzen|kenefick|locomotive|model railroad|train museum|railroad museum|railway museum|railroad history|union pacific)\b/i.test(hay)) {
    return true;
  }
  if (/\b(botanical\s+garden|arboretum)\b/i.test(hay)) return true;
  // Plain "… Gardens" venues next to the zoo (e.g. Lauritzen) — still allow names that clearly reference the zoo.
  if (/\bgardens?\b/i.test(hay) && !/\b(zoo|doorly|henry|aquarium|exhibit|jungle|dome)\b/i.test(hay)) return true;
  return false;
}

/**
 * For a zoo umbrella anchor: child must look like an on-zoo exhibit or strongly zoo-branded POI.
 * Broad "tourist_attraction within 1200m" pulled in Kenefick Locomotive Museum, Lauritzen Gardens, etc.
 */
function zooExhibitLikeChild(anchor, child, distMeters) {
  if (isZooCampusChildBlocklisted(child)) return false;
  const n = (child.name || '').toLowerCase();
  if (/\b(henry|doorly)\b/.test(n)) return true;
  if (nameSuggestsCampusExhibitNotRoot(child.name)) return true;

  const ZOO_EXHIBIT_HINT = /\b(exhibit|dome|jungle|kingdom|habitat|aviary|aquarium|reef|bay|stingray|penguin|shark|safari|desert|nocturnal|gorilla|hubbard|lied|mutual|highlands|carousel|skyfari|rainforest|savanna|canyon|lagoon|odyssey|swamp|insect|butterfly|wildlife|orchid|forest|primate|feline|aquatic)\b/i;
  if (ZOO_EXHIBIT_HINT.test(n)) return true;

  const types = (child.types || []).map((t) => String(t).toLowerCase());
  const aquariumMaxM = parseInt(process.env.VENUE_ZOO_AQUARIUM_BUILDING_MAX_M || '1400', 10);
  if (types.includes('aquarium')) return distMeters <= aquariumMaxM;

  if (types.includes('zoo') && !isPrimaryCampusAnchor(child)) {
    const hutMaxM = parseInt(process.env.VENUE_ZOO_TAGGED_HUT_MAX_M || '450', 10);
    return distMeters <= hutMaxM;
  }

  if (types.includes('museum')) {
    if (ZOO_EXHIBIT_HINT.test(n)) return true;
    if (/\b(henry|doorly|wildlife|natural|naturalist|science)\b/i.test(n)) return true;
    return false;
  }

  if (types.includes('tourist_attraction')) {
    return ZOO_EXHIBIT_HINT.test(n) || /\b(henry|doorly)\b/.test(n) || nameSuggestsCampusExhibitNotRoot(child.name);
  }

  const hasOnGroundsType = types.some((t) => /^(establishment|point_of_interest)$/.test(t));
  if (hasOnGroundsType) {
    const poiMaxM = parseInt(process.env.VENUE_ZOO_POI_MAX_M || '800', 10);
    if (distMeters > poiMaxM) return false;
    return ZOO_EXHIBIT_HINT.test(n) || /\b(henry|doorly)\b/.test(n) || nameSuggestsCampusExhibitNotRoot(child.name);
  }

  return false;
}

/** Primary campus umbrella that is not a zoo — museums / aquariums need tight exhibit rules (no downtown chaining). */
function isNonZooStrictPrimaryCampusAnchor(place) {
  return isPrimaryCampusAnchor(place) && !isZooUmbrellaAnchor(place);
}

const GENERIC_MERGE_NAME_TOKENS = new Set([
  'museum', 'galleries', 'gallery', 'children', 'child', 'public', 'omaha', 'downtown', 'park',
  'center', 'centre', 'library', 'branch', 'city', 'state', 'regional', 'landing', 'riverfront',
]);

/** Distinctive ≥4-char tokens shared by anchor/child names (strips generic words like "museum"). */
function campusDistinctTokenOverlap(anchor, child) {
  const a = extractSignificantTokens(anchor.name).filter(
    (t) => t.length >= 4 && !GENERIC_MERGE_NAME_TOKENS.has(t),
  );
  const b = new Set(
    extractSignificantTokens(child.name).filter((t) => t.length >= 4 && !GENERIC_MERGE_NAME_TOKENS.has(t)),
  );
  return a.some((t) => b.has(t));
}

/**
 * For museum / non-zoo campus umbrellas: reject obvious non-exhibit neighbors.
 */
function isCampusStrictAnchorIncompatibleChild(anchor, child) {
  if (isLibraryLikePlace(child)) return true;
  if (isSchoolLikePlace(child)) return true;
  const types = (child.types || []).map((t) => String(t).toLowerCase());
  if (types.includes('shopping_mall')) return true;
  if (isNonSplashSwimmingPoolLike(child)) return true;
  const an = (anchor.name || '').toLowerCase();
  const museumLikeAnchor = /\b(museum|gallery)\b/i.test(an);
  if (museumLikeAnchor && types.includes('park')) return true;
  return false;
}

/**
 * Tight "on-campus" attachment for non-zoo primary anchors (museums, stand-alone aquariums, etc.).
 */
function nonZooCampusGroundsChild(anchor, child, distMeters) {
  if (isCampusStrictAnchorIncompatibleChild(anchor, child)) return false;
  if (campusDistinctTokenOverlap(anchor, child)) return true;
  if (nameSuggestsCampusExhibitNotRoot(child.name)) return true;

  const strictVisitorM = parseInt(process.env.VENUE_MUSEUM_CAMPUS_VISITOR_M || '380', 10);
  const strictPoiM = parseInt(process.env.VENUE_MUSEUM_CAMPUS_POI_M || '220', 10);
  const sameBuildingM = parseInt(process.env.VENUE_CAMPUS_SAME_BUILDING_M || '48', 10);

  if (distMeters <= sameBuildingM && hasVisitorFacingGoogleType(child)) return true;

  const anchorAddr = normalizeAddress(anchor.address || '');
  const childAddr = normalizeAddress(child.address || '');
  if (anchorAddr && childAddr && anchorAddr === childAddr && anchorAddr.length > 8) {
    return distMeters <= Math.min(strictVisitorM, 420);
  }

  if (hasVisitorFacingGoogleType(child) && distMeters <= strictVisitorM) {
    const n = (child.name || '').toLowerCase();
    return /\b(wing|gallery|hall|exhibit|visitor|entrance|theater|theatre|collection|sculpture)\b/.test(n);
  }

  const types = (child.types || []).map((t) => String(t).toLowerCase());
  const hasOnGroundsType = types.some((t) => /^(establishment|point_of_interest)$/.test(t));
  if (hasOnGroundsType && distMeters <= strictPoiM) {
    const n = (child.name || '').toLowerCase();
    return /\b(ticket|gift|entrance|lobby|coat|audio|tour|exhibit)\b/.test(n);
  }

  return false;
}

function hasParkParentType(place) {
  const types = (place.types || []).map((t) => String(t).toLowerCase());
  if (types.some((t) => PARK_PARENT_TYPES.has(t))) return true;
  return /\b(public\s+)?park\b/i.test(place.name || '') || /\bpark\b/i.test(place.playgroundType || '');
}

/** City offices / maintenance yards — not a public park parent for amenity clustering. */
function isParksDepartmentOrOfficeName(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.toLowerCase();
  return /\b(parks\s+department|recreation\s+department|parks\s+dept|recreation\s+dept|parks\s+and\s+recreation\s+department)\b/.test(n)
    || /\bdepartment\s+shop\b/.test(n);
}

function isPrimaryParkAnchor(place) {
  if (!hasParkParentType(place)) return false;
  const name = place.name || '';
  if (/\b(campground|rv\s+park)\b/i.test(name)) return false;
  if (isParksDepartmentOrOfficeName(name)) return false;
  if (isNonSplashSwimmingPoolLike(place)) return false;
  if (CHILD_AMENITY_TERMS.test(name)) return false;
  return /\bpark|recreation\s+(area|center)|sports\s+complex|athletic\s+complex|nature\s+center\b/i.test(name)
    || /\bpark|sports\s+complex|nature\s+center\b/i.test(place.playgroundType || '');
}

function isNonSplashSwimmingPoolLike(place) {
  const hay = `${place.name || ''} ${place.playgroundType || ''}`.toLowerCase();
  if (/\b(splash|spray|sprayground|splashpad)\b/.test(hay)) return false;
  return /\b(swimming\s*pool|swim\s*club|swimming\s+club|pool\s+association|aquatics?\s+center|country\s+club\s+swimming|klub\s+swimming)\b/.test(hay)
    || (/\bpool\b/.test(hay) && /\b(swimming|swim)\b/.test(hay));
}

function isLibraryLikePlace(place) {
  const types = (place.types || []).map((t) => String(t).toLowerCase());
  if (types.includes('library')) return true;
  const n = (place.name || '').toLowerCase();
  return /\b(public\s+)?library\b/.test(n) || /\bbranch,?\s+omaha\s+public\s+library\b/.test(n);
}

function isSchoolLikePlace(place) {
  const types = (place.types || []).map((t) => String(t).toLowerCase());
  if (types.includes('school') || types.includes('university')) return true;
  const n = (place.name || '').toLowerCase();
  return /\b(elementary|middle|high)\s+school\b/.test(n) || /\bprimary\s+school\b/.test(n);
}

function isParkAmenityCandidate(place) {
  if (isObviousNonCampusChild(place.name)) return false;
  if (isNonSplashSwimmingPoolLike(place)) return false;
  if (isLibraryLikePlace(place)) return false;
  if (isSchoolLikePlace(place)) return false;
  const hayName = `${place.name || ''} ${place.playgroundType || ''}`.trim();
  if (isPrimaryParkAnchor(place) && !CHILD_AMENITY_TERMS.test(hayName)) {
    return false;
  }
  const name = hayName;
  const types = (place.types || []).map((t) => String(t).toLowerCase());
  return CHILD_AMENITY_TERMS.test(name)
    || types.some((t) => PARK_CHILD_TYPES.has(t))
    || /\b(playground|splash|trail|field|court|dog\s*park|skate\s*park|pavilion|picnic|shelter|garden|lake|pond)\b/i.test(place.playgroundType || '');
}

function isGenericParkAmenityName(name) {
  if (!name || typeof name !== 'string') return false;
  const cleaned = stripVenueNoise(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return false;

  const genericTerms = new Set([
    'park', 'playground', 'splash', 'pad', 'sprayground', 'spray', 'field', 'fields',
    'court', 'courts', 'trail', 'trails', 'trailhead', 'walking', 'bike', 'biking',
    'pavilion', 'picnic', 'shelter', 'pool', 'aquatic', 'garden', 'lake', 'pond',
    'dog', 'skate', 'soccer', 'baseball', 'softball', 'football',
  ]);
  const tokens = cleaned.split(' ').filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((t) => genericTerms.has(t) || /^\d+$/.test(t));
}

function hasSharedSignificantToken(a, b) {
  const aTokens = extractSignificantTokens(a.name);
  const bTokens = new Set(extractSignificantTokens(b.name));
  return aTokens.some((t) => t.length >= 4 && bTokens.has(t));
}

/** Generic "Field #4" / "Dog Park" rows must repeat the anchor's distinctive tokens (not just be nearby). */
function anchorBrandingAppearsInChildName(anchor, child) {
  const cn = (child.name || '').toLowerCase();
  return extractSignificantTokens(anchor.name).some((t) => t.length >= 4 && cn.includes(t));
}

function shouldAttachAsParkChild(anchor, child, distMeters) {
  if (!isPrimaryParkAnchor(anchor)) return false;
  if (String(anchor._id) === String(child._id)) return false;
  if (conflictingFortNamedVenues(anchor, child)) return false;
  if (!isParkAmenityCandidate(child)) return false;
  if (hasFoodOrRetailGoogleType(child)) return false;
  if (isNonSplashSwimmingPoolLike(child)) return false;
  if (isLibraryLikePlace(child)) return false;
  if (isSchoolLikePlace(child)) return false;

  const maxRadius = parseInt(process.env.VENUE_PARK_CLUSTER_RADIUS_M || '900', 10);
  if (distMeters > maxRadius) return false;

  if (hasSharedSignificantToken(anchor, child)) return true;

  const anchorAddress = normalizeAddress(anchor.address || '');
  const childAddress = normalizeAddress(child.address || '');
  const childNeedsAnchorBrand = /\b(field|fields|#\s*\d|soccer|softball|baseball|concession|shelter|restroom|amphitheater)\b/i.test(child.name || '');
  if (childNeedsAnchorBrand && !anchorBrandingAppearsInChildName(anchor, child)) {
    if (!(anchorAddress && childAddress && anchorAddress === childAddress)) return false;
  }

  if (anchorAddress && childAddress && anchorAddress === childAddress) return true;

  const genericAmenityRadius = parseInt(process.env.VENUE_PARK_GENERIC_CHILD_RADIUS_M || '700', 10);
  if (distMeters <= genericAmenityRadius && isGenericParkAmenityName(child.name || '')) {
    return hasSharedSignificantToken(anchor, child) || anchorBrandingAppearsInChildName(anchor, child);
  }

  const looseRadius = parseInt(process.env.VENUE_PARK_LOOSE_CHILD_RADIUS_M || '350', 10);
  if (distMeters <= looseRadius && CHILD_AMENITY_TERMS.test(child.name || '')) {
    return hasSharedSignificantToken(anchor, child) || anchorBrandingAppearsInChildName(anchor, child);
  }
  return false;
}

/**
 * First-hop distance cap from anchor before exhibit rules run. Large zoos need a wider gate
 * than museums — otherwise `shouldAttachAsCampusChild` returns false before zoo exhibit logic.
 */
function campusPrimaryAttachMaxMeters(anchor) {
  if (!isPrimaryCampusAnchor(anchor)) {
    return parseInt(process.env.VENUE_CAMPUS_CLUSTER_RADIUS_M || '500', 10);
  }
  if (isZooUmbrellaAnchor(anchor)) {
    return parseInt(
      process.env.VENUE_ZOO_PRIMARY_CAMPUS_CLUSTER_RADIUS_M
        || process.env.VENUE_PRIMARY_CAMPUS_CLUSTER_RADIUS_M
        || '3200',
      10,
    );
  }
  return parseInt(process.env.VENUE_PRIMARY_CAMPUS_CLUSTER_RADIUS_M || '1400', 10);
}

function campusExhibitVisitorMeters(anchor) {
  if (isZooUmbrellaAnchor(anchor)) {
    return parseInt(
      process.env.VENUE_ZOO_CAMPUS_EXHIBIT_VISITOR_M
        || process.env.VENUE_CAMPUS_EXHIBIT_VISITOR_M
        || '2400',
      10,
    );
  }
  return parseInt(process.env.VENUE_CAMPUS_EXHIBIT_VISITOR_M || '1200', 10);
}

function campusExhibitOnGroundsMeters(anchor) {
  if (isZooUmbrellaAnchor(anchor)) {
    return parseInt(
      process.env.VENUE_ZOO_CAMPUS_EXHIBIT_ON_GROUNDS_M
        || process.env.VENUE_CAMPUS_EXHIBIT_ON_GROUNDS_M
        || '2000',
      10,
    );
  }
  return parseInt(process.env.VENUE_CAMPUS_EXHIBIT_ON_GROUNDS_M || '1000', 10);
}

/**
 * Whether child should attach to anchor for campus-style sub-venue grouping.
 * Uses: shared name prefix, significant token overlap, or (for primary anchors) visitor-facing / on-grounds POIs within radius.
 */
function shouldAttachAsCampusChild(anchor, child, distMeters) {
  const maxRadius = campusPrimaryAttachMaxMeters(anchor);
  if (distMeters > maxRadius) return false;
  if (String(anchor._id) === String(child._id)) return false;
  if (conflictingFortNamedVenues(anchor, child)) return false;
  if (!isCampusAnchorCandidate(anchor)) return false;
  if (isObviousNonCampusChild(child.name)) return false;
  const na = (anchor.name || '').toLowerCase();
  const nc = (child.name || '').toLowerCase();
  if ((na.includes('schema') && nc.includes('schramm')) || (na.includes('schramm') && nc.includes('schema'))) {
    return false;
  }

  const strongNameMatch = () => {
    const aName = stripVenueNoise(anchor.name || '');
    const cName = stripVenueNoise(child.name || '');
    const lcp = longestCommonPrefix([aName, cName]);
    if (lcp && lcp.trim().split(/\s+/).length >= 2) return true;
    const aTokens = extractSignificantTokens(anchor.name);
    const cLower = cName.toLowerCase();
    for (const t of aTokens) {
      if (t.length >= 4 && cLower.includes(t)) return true;
    }
    return false;
  };

  if (/\b(mini[\s-]?golf|putt[\s-]?putt|miniature\s+golf)\b/i.test(child.name || '') && !strongNameMatch()) {
    return false;
  }

  // Two primary-scale listings for the same campus (duplicate main POIs)
  if (isPrimaryCampusAnchor(anchor) && isPrimaryCampusAnchor(child)) {
    const dualMergeM = parseInt(process.env.VENUE_CAMPUS_DUAL_PRIMARY_MERGE_M || '95', 10);
    const sameBuildingM = parseInt(process.env.VENUE_CAMPUS_SAME_BUILDING_M || '48', 10);
    if (distMeters <= sameBuildingM) return true;
    if (distMeters <= dualMergeM && strongNameMatch()) return true;
    return false;
  }

  if (strongNameMatch()) {
    if (hasFoodOrRetailGoogleType(child) && !hasVisitorFacingGoogleType(child)) return false;
    return true;
  }

  if (hasFoodOrRetailGoogleType(child)) return false;

  // Primary campus root: attach exhibits & on-grounds POIs even when names share no tokens ("Lied Jungle" vs "Henry Doorly Zoo")
  if (isPrimaryCampusAnchor(anchor)) {
    const visitorR = campusExhibitVisitorMeters(anchor);
    const onGroundsR = campusExhibitOnGroundsMeters(anchor);

    // Zoo umbrella: do not treat every tourist_attraction/museum/POI within 1km as an exhibit (adjacent gardens, rail museums, …).
    if (isZooUmbrellaAnchor(anchor)) {
      if (hasVisitorFacingGoogleType(child) && distMeters <= visitorR) {
        return zooExhibitLikeChild(anchor, child, distMeters);
      }
      const types = (child.types || []).map((t) => String(t).toLowerCase());
      const hasOnGroundsType = types.some((t) => /^(establishment|point_of_interest)$/.test(t));
      if (distMeters <= onGroundsR && hasOnGroundsType && !hasFoodOrRetailGoogleType(child)) {
        return zooExhibitLikeChild(anchor, child, distMeters);
      }
      return false;
    }

    // Museums / stand-alone aquariums: do not use the loose "any tourist_attraction within 1.2km" rule
    // (it chains unrelated downtown venues and Council Bluffs parks into one component).
    if (isNonZooStrictPrimaryCampusAnchor(anchor)) {
      if (hasVisitorFacingGoogleType(child) && distMeters <= visitorR) {
        return nonZooCampusGroundsChild(anchor, child, distMeters);
      }
      const typesZ = (child.types || []).map((t) => String(t).toLowerCase());
      const hasOnGroundsTypeZ = typesZ.some((t) => /^(establishment|point_of_interest)$/.test(t));
      if (distMeters <= onGroundsR && hasOnGroundsTypeZ && !hasFoodOrRetailGoogleType(child)) {
        return nonZooCampusGroundsChild(anchor, child, distMeters);
      }
      return false;
    }

    if (hasVisitorFacingGoogleType(child) && distMeters <= visitorR) return true;
    const types = (child.types || []).map((t) => String(t).toLowerCase());
    // establishment/point_of_interest POIs within on-grounds radius — catches exhibits
    // Google doesn't tag as tourist_attraction (e.g. "Stingray Beach", "Skyfari", "Desert Dome")
    const hasOnGroundsType = types.some((t) => /^(establishment|point_of_interest)$/.test(t));
    if (distMeters <= onGroundsR && hasOnGroundsType && !hasFoodOrRetailGoogleType(child)) return true;
    return false;
  }

  const tightRadius = parseInt(process.env.VENUE_CAMPUS_TIGHT_RADIUS_M || '280', 10);
  if (distMeters > tightRadius) return false;
  if (!hasStrongCampusGoogleType(anchor)) return false;
  if (!hasVisitorFacingGoogleType(child)) return false;

  return true;
}

function isStandaloneCampgroundListing(p) {
  const types = (p.types || []).map((t) => String(t).toLowerCase());
  const n = (p.name || '').toLowerCase();
  return types.includes('campground') || /\b(campground|rv\s+park)\b/.test(n);
}

/** In campus graph: not fast-food etc., and plausibly zoo/museum grounds or exhibit. */
function isCampusClusterEligible(p) {
  if (isObviousNonCampusChild(p.name)) return false;
  if (hasFoodOrRetailGoogleType(p)) return false;
  if (isStandaloneCampgroundListing(p)) return false;
  return (
    isCampusAnchorCandidate(p)
    || hasVisitorFacingGoogleType(p)
    || hasStrongCampusGoogleType(p)
    // Allow establishment/point_of_interest POIs — they may be on-grounds exhibits
    // that Google doesn't tag with a visitor-facing type (e.g. "Stingray Beach", "Skyfari")
    || ((p.types || []).some((t) => /^(establishment|point_of_interest)$/i.test(t)))
  );
}

/** "Fort Atkinson …" vs "Fort Calhoun …" — same region, different forts; do not campus/park merge. */
function conflictingFortNamedVenues(a, b) {
  const fortKey = (name) => {
    const m = String(name || '').match(/\bfort\s+([a-z0-9'\-]+)/i);
    return m ? m[1].toLowerCase().replace(/[^a-z0-9']/g, '') : '';
  };
  const fa = fortKey(a.name);
  const fb = fortKey(b.name);
  return Boolean(fa && fb && fa !== fb);
}

/** Symmetric link — reuses all attach rules so we don't invent new thresholds. */
function campusPairLinked(a, b, distMeters) {
  return (
    shouldAttachAsCampusChild(a, b, distMeters)
    || shouldAttachAsCampusChild(b, a, distMeters)
  );
}

/**
 * Legacy greedy campus clustering (one anchor at a time). Can force via VENUE_CAMPUS_LEGACY_GREEDY=1.
 */
function buildCampusClustersGreedy(places) {
  const valid = places.filter(hasValidLocation).filter(isCampusClusterEligible);
  let seeds = valid
    .filter(isPrimaryCampusAnchor)
    .sort((a, b) => {
      const d = scorePlace(b) - scorePlace(a);
      if (d !== 0) return d;
      return String(a._id).localeCompare(String(b._id));
    });

  if (seeds.length === 0) {
    seeds = valid
      .filter(isCampusAnchorCandidate)
      .sort((a, b) => {
        const d = scorePlace(b) - scorePlace(a);
        if (d !== 0) return d;
        return String(a._id).localeCompare(String(b._id));
      });
  }

  const consumed = new Set();
  const clusters = [];

  for (const anchor of seeds) {
    const aid = String(anchor._id);
    if (consumed.has(aid)) continue;

    const cluster = [anchor];
    consumed.add(aid);

    for (const p of valid) {
      const pid = String(p._id);
      if (consumed.has(pid)) continue;
      if (!hasValidLocation(p)) continue;
      const dist = haversineMeters(
        anchor.location.coordinates[1],
        anchor.location.coordinates[0],
        p.location.coordinates[1],
        p.location.coordinates[0],
      );
      if (!shouldAttachAsCampusChild(anchor, p, dist)) continue;
      cluster.push(p);
      consumed.add(pid);
    }

    if (cluster.length >= 2) clusters.push(cluster);
  }

  return clusters;
}

/**
 * Campus / zoo / museum: one parent per connected component (no manual “which is the zoo”).
 * Builds a graph on eligible POIs; edge if shouldAttach holds in either direction (same rules as before).
 * Winner = highest scorePlace among isPrimaryCampusAnchor in the component, else among isCampusAnchorCandidate.
 * @param {Object[]} places
 * @returns {Object[][]}
 */
function hasValidLocation(p) {
  return (
    p.location
    && Array.isArray(p.location.coordinates)
    && p.location.coordinates.length >= 2
    && Number.isFinite(p.location.coordinates[0])
    && Number.isFinite(p.location.coordinates[1])
  );
}

/**
 * For proximity / cross-region merges: reject null island and other placeholders that are
 * finite but not real positions — otherwise unrelated rows share 0m distance and spuriously cluster.
 * GeoJSON order: [lng, lat].
 */
function hasTrustworthyCoordinatesForMerge(p) {
  if (!hasValidLocation(p)) return false;
  const lng = p.location.coordinates[0];
  const lat = p.location.coordinates[1];
  // Null island and near-zero placeholders (~±11m); still finite so hasValidLocation alone is not enough.
  if (Math.abs(lat) <= 1e-4 && Math.abs(lng) <= 1e-4) return false;
  return true;
}

function buildCampusClusters(places) {
  if (process.env.VENUE_CAMPUS_LEGACY_GREEDY === '1' || process.env.VENUE_CAMPUS_LEGACY_GREEDY === 'true') {
    return buildCampusClustersGreedy(places);
  }

  const valid = places.filter(hasValidLocation).filter(isCampusClusterEligible);
  if (valid.length < 2) return [];

  const n = valid.length;
  const uf = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    if (uf[x] !== x) uf[x] = find(uf[x]);
    return uf[x];
  }
  function unite(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) uf[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = valid[i];
      const b = valid[j];
      const dist = haversineMeters(
        a.location.coordinates[1], a.location.coordinates[0],
        b.location.coordinates[1], b.location.coordinates[0],
      );
      if (campusPairLinked(a, b, dist)) unite(i, j);
    }
  }

  const compMap = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!compMap.has(r)) compMap.set(r, []);
    compMap.get(r).push(valid[i]);
  }

  const clusters = [];
  for (const [, members] of compMap) {
    if (members.length < 2) continue;
    const span = maxPairwiseHaversineMeters(members);
    const hasZooUmbrella = members.some(isZooUmbrellaAnchor);
    const spanCap = hasZooUmbrella
      ? parseInt(process.env.VENUE_CAMPUS_MAX_COMPONENT_DIAMETER_ZOO_M || '4200', 10)
      : parseInt(process.env.VENUE_CAMPUS_MAX_COMPONENT_DIAMETER_M || '1800', 10);
    if (span > spanCap) continue;

    const primaries = members.filter(isPrimaryCampusAnchor);
    let winner;
    if (primaries.length > 0) {
      winner = pickHigherScoredCampusParent(primaries);
    } else {
      const candidates = members.filter(isCampusAnchorCandidate);
      if (candidates.length === 0) continue;
      winner = pickHigherScoredCampusParent(candidates);
    }
    const rest = members.filter((p) => String(p._id) !== String(winner._id));
    clusters.push([winner, ...rest]);
  }

  return clusters;
}

function buildParkAmenityClusters(places) {
  const valid = places.filter(hasValidLocation);
  const anchors = valid
    .filter(isPrimaryParkAnchor)
    .sort((a, b) => {
      const d = scoreParkClusterParent(b) - scoreParkClusterParent(a);
      if (d !== 0) return d;
      return String(a._id).localeCompare(String(b._id));
    });
  if (anchors.length === 0) return [];

  const consumed = new Set();
  const clusters = [];
  for (const anchor of anchors) {
    const aid = String(anchor._id);
    if (consumed.has(aid)) continue;

    const cluster = [anchor];
    for (const p of valid) {
      const pid = String(p._id);
      if (pid === aid || consumed.has(pid)) continue;
      const dist = haversineMeters(
        anchor.location.coordinates[1],
        anchor.location.coordinates[0],
        p.location.coordinates[1],
        p.location.coordinates[0],
      );
      if (!shouldAttachAsParkChild(anchor, p, dist)) continue;
      cluster.push(p);
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
      for (const p of cluster) consumed.add(String(p._id));
    }
  }

  return clusters;
}

/**
 * Among campus umbrella / anchor candidates, pick the highest {@link scoreCampusClusterParent};
 * break ties deterministically (duplicate Google umbrella rows for one campus).
 */
function pickHigherScoredCampusParent(candidates) {
  if (!candidates || candidates.length === 0) return null;
  return candidates.reduce((best, p) => {
    const sa = scoreCampusClusterParent(best);
    const sb = scoreCampusClusterParent(p);
    if (sb > sa) return p;
    if (sb < sa) return best;
    return String(p._id).localeCompare(String(best._id)) < 0 ? p : best;
  });
}

/**
 * Campus parent: prefer umbrella zoo/museum (primary anchor) over exhibits with higher photo scores.
 */
function selectCampusClusterParent(group) {
  if (!group || group.length === 0) return null;
  const primaries = group.filter(isPrimaryCampusAnchor);
  if (primaries.length > 0) {
    return pickHigherScoredCampusParent(primaries);
  }
  const candidates = group.filter(isCampusAnchorCandidate);
  if (candidates.length > 0) {
    return pickHigherScoredCampusParent(candidates);
  }
  return selectWinner(group);
}

function selectParkClusterParent(group) {
  if (!group || group.length === 0) return null;
  const anchors = group.filter(isPrimaryParkAnchor);
  if (anchors.length > 0) {
    return anchors.reduce((best, p) => (scoreParkClusterParent(p) > scoreParkClusterParent(best) ? p : best));
  }
  return selectWinner(group);
}

/**
 * Dry-run preview of campus / large-venue clusters (no DB writes).
 * Shape matches proximity dedup cluster items: winner, members, count.
 * @param {string} regionKey
 * @returns {Promise<{ clusterCount: number, clusters: Array<{ winner: string, members: string[], count: number }> }>}
 */
async function previewCampusClusters(regionKey) {
  const db = getDb();
  const places = await db.collection('playgrounds').find(playgroundsInMergeRegion(regionKey)).toArray();
  const raw = buildCampusClusters(places);
  return {
    clusterCount: raw.length,
    clusters: raw.map((c) => {
      const winner = selectCampusClusterParent(c);
      return {
        winner: winner.name,
        members: c.map((p) => p.name),
        count: c.length,
      };
    }),
  };
}

async function previewParkAmenityClusters(regionKey) {
  const db = getDb();
  const places = await db.collection('playgrounds').find(playgroundsInMergeRegion(regionKey)).toArray();
  const campusClusters = buildCampusClusters(places);
  const campusChildIds = new Set();
  for (const c of campusClusters) {
    const winner = selectCampusClusterParent(c);
    for (const p of c) {
      if (String(p._id) !== String(winner._id)) campusChildIds.add(String(p._id));
    }
  }
  const afterCampus = places.filter((p) => !campusChildIds.has(String(p._id)));
  const raw = buildParkAmenityClusters(afterCampus);
  return {
    clusterCount: raw.length,
    clusters: raw.map((c) => {
      const winner = selectParkClusterParent(c);
      return {
        winner: winner.name,
        members: c.map((p) => p.name),
        count: c.length,
      };
    }),
  };
}

/**
 * Removes places that would be absorbed as campus children, leaving one winner per campus cluster.
 * Matches DB state after the campus merge pass (children deleted).
 * @param {Object[]} places
 * @returns {Object[]}
 */
function simulatePlacesAfterCampusMerge(places) {
  const childIds = new Set();
  for (const c of buildCampusClusters(places)) {
    const winner = selectCampusClusterParent(c);
    for (const p of c) {
      if (String(p._id) !== String(winner._id)) childIds.add(String(p._id));
    }
  }
  for (const c of buildParkAmenityClusters(places)) {
    const winner = selectParkClusterParent(c);
    for (const p of c) {
      if (String(p._id) !== String(winner._id)) childIds.add(String(p._id));
    }
  }
  return places.filter((p) => !childIds.has(String(p._id)));
}

function addressClusterMembersIncompatible(a, b) {
  if (conflictingFortNamedVenues(a, b)) return true;
  if ((isSchoolLikePlace(a) && !isSchoolLikePlace(b)) || (isSchoolLikePlace(b) && !isSchoolLikePlace(a))) {
    return true;
  }
  if (isLibraryLikePlace(a) && isSchoolLikePlace(b)) return true;
  if (isLibraryLikePlace(b) && isSchoolLikePlace(a)) return true;
  if ((isLibraryLikePlace(a) && /\b(museum|gallery)\b/i.test(b.name || ''))
    || (isLibraryLikePlace(b) && /\b(museum|gallery)\b/i.test(a.name || ''))) {
    if (!hasSharedSignificantToken(a, b)) return true;
  }
  const commA = /\bcommunity\s+center\b/i.test(a.name || '');
  const commB = /\bcommunity\s+center\b/i.test(b.name || '');
  if (commA && isSchoolLikePlace(b)) return true;
  if (commB && isSchoolLikePlace(a)) return true;
  if ((isLibraryLikePlace(a) && commB) || (isLibraryLikePlace(b) && commA)) return true;
  if ((commA || /\bsenior\s+center\b/i.test(a.name || '')) && isNonSplashSwimmingPoolLike(b)) return true;
  if ((commB || /\bsenior\s+center\b/i.test(b.name || '')) && isNonSplashSwimmingPoolLike(a)) return true;
  const na = (a.name || '').toLowerCase();
  const nb = (b.name || '').toLowerCase();
  if (na.includes('park') && nb.includes('park') && !hasSharedSignificantToken(a, b)
    && !anchorBrandingAppearsInChildName(a, b) && !anchorBrandingAppearsInChildName(b, a)) {
    return true;
  }
  return false;
}

/**
 * Same normalized address can still be junk for unrelated venues — split into ≤N-meter components.
 * @param {Object[]} group
 * @returns {Object[][]}
 */
function splitAddressGroupIntoSpatialComponents(group) {
  if (group.length < 2) return [];
  const n = group.length;
  const uf = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    if (uf[x] !== x) uf[x] = find(uf[x]);
    return uf[x];
  }
  function unite(i, j) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) uf[ri] = rj;
  }
  const maxM = parseInt(process.env.VENUE_ADDRESS_CLUSTER_LINK_M || '110', 10);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = group[i];
      const b = group[j];
      if (addressClusterMembersIncompatible(a, b)) continue;
      if (!hasValidLocation(a) || !hasValidLocation(b)) continue;
      const d = haversineMeters(
        a.location.coordinates[1], a.location.coordinates[0],
        b.location.coordinates[1], b.location.coordinates[0],
      );
      if (d <= maxM) unite(i, j);
    }
  }
  const comp = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!comp.has(r)) comp.set(r, []);
    comp.get(r).push(group[i]);
  }
  return [...comp.values()].filter((g) => g.length >= 2);
}

/**
 * Groups by normalized address (≥3 words) + 50m proximity to an existing multi-entry group.
 * @param {Object[]} places
 * @returns {Object[][]} clusters with length ≥ 2 only
 */
function buildAddressSubvenueGroups(places) {
  const addressGroups = new Map();
  for (const place of places) {
    if (!place.address) continue;
    const normalizedAddr = normalizeAddress(place.address);
    if (!normalizedAddr) continue;
    const wordCount = normalizedAddr.split(' ').filter((w) => w.length > 0).length;
    if (wordCount < 3) continue;
    if (!addressGroups.has(normalizedAddr)) {
      addressGroups.set(normalizedAddr, []);
    }
    addressGroups.get(normalizedAddr).push(place);
  }

  const ungrouped = places.filter((p) => {
    if (!p.address) return true;
    const norm = normalizeAddress(p.address);
    return !norm || (addressGroups.get(norm) || []).length < 2;
  });

  for (const place of ungrouped) {
    for (const [, group] of addressGroups) {
      if (group.length < 2) continue;
      if (group.some((g) => String(g._id) === String(place._id))) continue;
      if (!hasValidLocation(place)) continue;
      const representative = group[0];
      if (!hasValidLocation(representative)) continue;
      const dist = haversineMeters(
        place.location.coordinates[1],
        place.location.coordinates[0],
        representative.location.coordinates[1],
        representative.location.coordinates[0]
      );
      // Same street number in noisy geocoder data is not enough — require tight proximity + name signal.
      if (dist <= 40
        && (hasSharedSignificantToken(place, representative) || anchorBrandingAppearsInChildName(representative, place))) {
        group.push(place);
        break;
      }
    }
  }

  const result = [];
  for (const [, group] of addressGroups) {
    if (group.length < 2) continue;
    for (const sub of splitAddressGroupIntoSpatialComponents(group)) {
      result.push(sub);
    }
  }
  return result;
}

/**
 * Dry-run address-based sub-venue groups after simulating campus merge (no DB writes).
 * @param {string} regionKey
 * @returns {Promise<{ clusterCount: number, clusters: Array<{ winner: string, members: string[], count: number }> }>}
 */
async function previewAddressSubvenueGroups(regionKey) {
  const db = getDb();
  const places = await db.collection('playgrounds').find(playgroundsInMergeRegion(regionKey)).toArray();
  const afterCampus = simulatePlacesAfterCampusMerge(places);
  const raw = buildAddressSubvenueGroups(afterCampus);
  return {
    clusterCount: raw.length,
    clusters: raw.map((c) => {
      const winner = selectWinner(c);
      return {
        winner: winner.name,
        members: c.map((p) => p.name),
        count: c.length,
      };
    }),
  };
}

// ─── Task 1.3: haversineMeters ───────────────────────────────────────────────
/**
 * Computes the great-circle distance between two lat/lng points in meters.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distance in meters
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Task 1.4: scorePlace ────────────────────────────────────────────────────
/**
 * Computes a composite score for a playground entry.
 * Higher score = better candidate to be the "winner" in a merge.
 * Favors: shorter names, generic suffixes, more photos/equipment/verifications.
 * @param {Object} place
 * @returns {number}
 */
function scorePlace(place) {
  let score = 0;

  // Prefer shorter names (more generic)
  const nameWords = (place.name || '').trim().split(/\s+/).length;
  score += Math.max(0, 10 - nameWords);

  // Prefer names ending in generic terms
  const lastWord = (place.name || '').trim().split(/\s+/).pop().toLowerCase();
  if (GENERIC_SUFFIXES.includes(lastWord)) score += 5;

  // Prefer more data
  score += (place.imageUrls || []).length * 0.5;
  score += (place.equipment || []).length * 0.3;
  score += (place.sportsCourts || []).length * 0.3;
  score += (place.verificationCount || 0) * 0.2;

  // Prefer entries with descriptions
  if (place.description && place.description.length > 20) score += 2;

  return score;
}

/**
 * Campus merge parent: prefer umbrella zoo / museum names over short exhibit titles
 * (raw scorePlace favors "Lied Jungle" over "Henry Doorly Zoo and Aquarium").
 */
function scoreCampusClusterParent(place) {
  const raw = place.name || '';
  const n = raw.toLowerCase();
  // Treat "&" like "and" for generic scoring (word count, suffix) so "Zoo & Aquarium" competes fairly with "Zoo and Aquarium".
  const placeForBaseScore = { ...place, name: raw.replace(/\s*&\s*/g, ' and ') };
  let s = scorePlace(placeForBaseScore);
  if (isZooAquariumSupportOrganizationName(place)) s -= 20000;
  if (isZooUmbrellaAnchor(place)) s += 2500;
  else if (isPrimaryCampusAnchor(place)) s += 500;
  if (nameSuggestsCampusExhibitNotRoot(raw)) s -= 450;
  const nNorm = n.replace(/\s*&\s*/g, ' and ');
  if (/\band\s+aquarium\b/.test(nNorm) || /\bzoo\s+and\s+aquarium\b/.test(nNorm)) s += 120;
  if ((place.types || []).map((t) => String(t).toLowerCase()).includes('zoo') && /\bzoo\b/.test(n)) s += 200;
  // Prefer the main gate listing over exhibit-style titles that still contain "Henry Doorly Zoo".
  if (/\bomaha'?s\s+henry\s+doorly\s+zoo(?:\s+and|\s*&)\s+aquarium\b/i.test(n)) s += 900;
  else if (/\bhenry\s+doorly\s+zoo(?:\s+and|\s*&)\s+aquarium\b/i.test(n)) s += 800;
  else if (/\bhenry\s+doorly\s+zoo\b/i.test(n)
    && !/\b(alaskan|adventure|expedition|hubbard|lied|stingray|simmons|gorilla|asian|madagascar|orangutan|aviary|infield|scott)\b/i.test(n)) {
    s += 400;
  }
  if (/\b(alaskan|adventure|expedition|hubbard|lied|stingray|simmons|gorilla|asian|madagascar|orangutan|aviary|infield|scott)\b/i.test(n)
    && /\bhenry\s+doorly\b/i.test(n)) {
    s -= 650;
  }
  return s;
}

/** Park amenity parent: prefer main preserve / state park over a day-camp sublisting. */
function scoreParkClusterParent(place) {
  let s = scorePlace(place);
  const n = (place.name || '').toLowerCase();
  if (/\b(state\s+park|national\s+forest|nature\s+center|preserve|national\s+park)\b/.test(n)) s += 140;
  if (/\b(forest|woods)\b/.test(n) && !/\b(camp|day\s*camp)\b/.test(n)) s += 90;
  if (/\b(camp\s+brewster|day\s*camp|summer\s*camp)\b/.test(n)) s -= 120;
  if (/\b(splash|spray|sprayground|splashpad)\b/.test(n)) s += 130;
  return s;
}

// ─── Task 1.5: selectWinner ──────────────────────────────────────────────────
/**
 * Returns the place with the highest composite score from an array of ≥2 entries.
 * @param {Object[]} places
 * @returns {Object}
 */
function selectWinner(places) {
  return places.reduce((best, current) => {
    return scorePlace(current) > scorePlace(best) ? current : best;
  });
}

// ─── Task 1.6: mergeFields ──────────────────────────────────────────────────
/**
 * Infer splash / skate / dog-park booleans from venue names when explicit flags are missing (common on seeded rows).
 * Skate uses the same signals as {@link inferPlaygroundType} (skate_park type, "skate park" / "skateboard park" names)
 * and excludes ice / roller rink phrases so UNMC-style ice rinks are not tagged.
 * @param {Object} place
 * @returns {{ hasSplashPad?: boolean, hasSkatePark?: boolean, isDogFriendly?: boolean }}
 */
function inferAmenityBooleansFromPlace(place) {
  const hay = `${place.name || ''} ${place.playgroundType || ''}`.toLowerCase();
  const out = {};
  if (/\b(splash\s*pad|splash\s*park|splashpad|spray\s*ground|sprayground|spray\s*pad|splash\s*zone)\b/.test(hay)) {
    out.hasSplashPad = true;
  }
  if (/\bdog\s*park\b/.test(hay) || /\boff[\s-]?leash\b/.test(hay) || /\bdog[\s-]?friendly\b/.test(hay)) {
    out.isDogFriendly = true;
  }
  const typesLower = (place.types || []).map((t) => String(t).toLowerCase());
  const iceOrRollerRinkHay = /\bice\s*(skating\s*)?rink\b|\bhockey\s*rink\b|\bfigure\s*skating\b|\bskating\s*rink\b|\bcurling\b|\broller\s*(rink|skating)\b/i.test(hay);
  if (!iceOrRollerRinkHay) {
    if (typesLower.includes('skate_park')) {
      out.hasSkatePark = true;
    } else if (/\bskate\s*park\b|skateboard\s*park/.test(hay)) {
      out.hasSkatePark = true;
    } else if (String(place.playgroundType || '').trim().toLowerCase() === 'skate park') {
      out.hasSkatePark = true;
    }
  }
  return out;
}

/**
 * Additively merges fields from losers into the winner.
 * - Array fields: union (deduplicated)
 * - Boolean amenity fields: OR (true wins)
 * - Trust scores: max per key
 * - Description: longest non-empty
 * - Verification count: sum
 * - Rating: weighted average by ratingCount
 *
 * @param {Object} winner
 * @param {Object[]} losers
 * @returns {Object} merged field object (not yet persisted)
 */
function mergeFields(winner, losers) {
  const allPlaces = [winner, ...losers];
  const merged = {};

  // Array fields — union (deduplicated)
  for (const field of ARRAY_FIELDS) {
    const all = allPlaces.flatMap(p => p[field] || []);
    if (field === 'imageUrls') {
      // Extra dedup for photos: strip google_photo: refs if a resolved URL exists,
      // and normalize URLs by removing query params for comparison
      const seen = new Set();
      merged[field] = all.filter(url => {
        if (!url) return false;
        // Skip unresolved google_photo: refs
        if (url.startsWith('google_photo:')) return false;
        // Do not promote app/default placeholder artwork into merged venue photo sets.
        if (isDefaultPlaceholderImageUrl(url)) return false;
        // Normalize: strip query params for dedup comparison
        const key = url.split('?')[0].toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } else {
      merged[field] = [...new Set(all)];
    }
  }

  // Boolean amenity fields — OR (true wins)
  for (const field of BOOL_FIELDS) {
    const values = allPlaces.map(p => p[field]).filter(v => v !== null && v !== undefined);
    if (values.length > 0) {
      merged[field] = values.some(v => v === true);
    }
  }
  // Legacy Mongo field `hasWaterFountain` ORs into `hasBottleFiller` (replaced product concept).
  if (allPlaces.some((p) => p.hasWaterFountain === true)) {
    merged.hasBottleFiller = true;
  }

  for (const p of allPlaces) {
    const inf = inferAmenityBooleansFromPlace(p);
    if (inf.hasSplashPad) merged.hasSplashPad = true;
    if (inf.hasSkatePark) merged.hasSkatePark = true;
    if (inf.isDogFriendly) merged.isDogFriendly = true;
  }

  // Trust scores — take max per field
  const trustScores = {};
  for (const place of allPlaces) {
    if (place.trustScores) {
      for (const [key, val] of Object.entries(place.trustScores)) {
        trustScores[key] = Math.max(trustScores[key] || 0, val);
      }
    }
  }
  if (Object.keys(trustScores).length > 0) merged.trustScores = trustScores;

  // Description — keep longest
  const descriptions = allPlaces.map(p => p.description).filter(Boolean);
  if (descriptions.length > 0) {
    merged.description = descriptions.reduce((a, b) => a.length >= b.length ? a : b);
  }

  // Verification count — sum
  merged.verificationCount = allPlaces.reduce((sum, p) => sum + (p.verificationCount || 0), 0);

  // Rating — weighted average by ratingCount
  const rated = allPlaces.filter(p => p.rating != null && p.ratingCount > 0);
  if (rated.length > 0) {
    const totalCount = rated.reduce((s, p) => s + p.ratingCount, 0);
    const weightedSum = rated.reduce((s, p) => s + p.rating * p.ratingCount, 0);
    merged.rating = Math.round((weightedSum / totalCount) * 10) / 10;
    merged.ratingCount = totalCount;
  }

  return merged;
}

// ─── Task 1.7: normalizeAddress ──────────────────────────────────────────────
/**
 * Normalizes an address for comparison: lowercase, strip street abbreviations,
 * remove non-alphanumeric, collapse whitespace.
 * @param {string} address
 * @returns {string}
 */
function normalizeAddress(address) {
  if (!address || typeof address !== 'string') return '';
  return address
    .toLowerCase()
    .replace(
      /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|pl|place)\b/g,
      ''
    )
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * First normalized address in the group that qualifies for address-based sub-venue grouping (≥3 tokens).
 * Stored on mergeInfo for audits when mergeType is subvenue_group.
 * @param {Object[]} group
 * @returns {string}
 */
function inferGroupNormalizedAddressKey(group) {
  if (!group || !group.length) return '';
  for (const p of group) {
    if (!p.address) continue;
    const n = normalizeAddress(p.address);
    if (!n) continue;
    const wordCount = n.split(' ').filter((w) => w.length > 0).length;
    if (wordCount >= 3) return n;
  }
  return '';
}

function explainMergeTypeForAudit(mergeType) {
  switch (mergeType) {
    case 'subvenue_group':
      return {
        code: mergeType,
        summary: 'Address-based sub-venue grouping',
        detail:
          'Rows were merged because they shared the same normalized street address (at least three address tokens after normalization) with another row, and/or one row was within 50m of an existing multi-entry group for that normalized address. Compare normalizedAddress fields below — matching keys strongly indicate this path.',
      };
    case 'subvenue_campus':
      return {
        code: mergeType,
        summary: 'Campus / large-venue clustering',
        detail:
          'Rows were grouped using campus-style heuristics (e.g. zoo, aquarium, museum): proximity and name/type signals, not identical mailing addresses. Different street addresses are expected.',
      };
    case 'subvenue_park':
      return {
        code: mergeType,
        summary: 'Park / amenity grouping',
        detail:
          'Rows were grouped because a parent park or recreation complex had nearby child-style amenities such as playgrounds, splash pads, fields, trails, pavilions, pools, or courts. The child rows remain on the parent as subVenues instead of separate top-level results.',
      };
    case 'proximity_dedup':
      return {
        code: mergeType,
        summary: 'Proximity name-prefix deduplication',
        detail:
          'Rows shared a common extracted name prefix and were within the configured distance (or were <10m apart). Address lines are not the primary signal.',
      };
    case 'cross_region_address':
      return {
        code: mergeType,
        summary: 'Cross-region duplicate (same normalized address)',
        detail:
          'Rows shared the same normalized address (≥3 tokens) and were within the max distance. At least two different regionKey values were present (border / dual-seed duplicates). The surviving row keeps the higher-scoring venue’s regionKey.',
      };
    default:
      return {
        code: mergeType || 'unknown',
        summary: mergeType ? 'Merge (other or legacy)' : 'No merge metadata',
        detail: mergeType
          ? 'See mergeInfo.mergeType. Older merges may omit normalizedAddressKey or other diagnostics.'
          : 'This playground has no mergeInfo — it was not recorded as a merge parent/winner, or predates merge metadata.',
      };
  }
}

/**
 * Admin audit: parent row, merge explanation, archived children with addresses + normalized forms.
 * @param {string|import('mongodb').ObjectId} playgroundId
 */
async function getMergeAudit(playgroundId) {
  const db = getDb();
  let oid;
  try {
    oid = typeof playgroundId === 'string' ? new ObjectId(playgroundId) : playgroundId;
  } catch (_e) {
    throw new Error('Invalid playground id');
  }

  const parent = await db.collection('playgrounds').findOne({ _id: oid });
  if (!parent) throw new Error('Playground not found');

  const mergeInfo = parent.mergeInfo || null;
  const howMergeWorked = explainMergeTypeForAudit(mergeInfo?.mergeType);

  const mergedFrom = mergeInfo?.mergedFrom || [];
  const mergedFromArchivedRows = [];

  for (const rawId of mergedFrom) {
    const arch = await db.collection('archived_playgrounds').findOne({ _id: rawId });
    if (arch) {
      mergedFromArchivedRows.push({
        id: String(arch._id),
        name: arch.name,
        address: arch.address || null,
        city: arch.city || null,
        state: arch.state || null,
        archiveReason: arch.archiveInfo?.reason,
        mergedIntoId: arch.archiveInfo?.mergedIntoId ? String(arch.archiveInfo.mergedIntoId) : null,
        normalizedAddress: normalizeAddress(arch.address || ''),
      });
    } else {
      mergedFromArchivedRows.push({
        id: String(rawId),
        note:
          'Not found in archived_playgrounds (already unlinked/restored, different DB, or id removed).',
      });
    }
  }

  const parentNorm = normalizeAddress(parent.address || '');
  const sameNormAsParent = mergedFromArchivedRows
    .filter((r) => r.normalizedAddress && parentNorm && r.normalizedAddress === parentNorm)
    .map((r) => r.id);

  return {
    parent: {
      id: String(parent._id),
      name: parent.name,
      address: parent.address || null,
      city: parent.city || null,
      state: parent.state || null,
      normalizedAddress: parentNorm,
      mergeInfo,
      subVenues: (parent.subVenues || []).map((sv) => ({
        id: sv.id != null ? String(sv.id) : '',
        name: sv.name,
        playgroundType: sv.playgroundType,
      })),
    },
    howMergeWorked,
    mergedFromArchivedRows,
    normalizedAddressKeyStoredOnRecord: mergeInfo?.normalizedAddressKey || null,
    addressHeuristicNote:
      'For subvenue_group, normalizedAddressKey on mergeInfo (newer merges) is the shared key used when grouping. For older merges, compare normalizedAddress on the parent vs each archived row.',
    archivedChildIdsSharingParentNormalizedAddress: sameNormAsParent,
  };
}

// ─── Task 2.1: proximityDedup ────────────────────────────────────────────────
/** Block prefix+proximity merges that are almost always duplicate POIs vs different businesses. */
function proximityDedupPairIncompatible(seed, candidate) {
  if (isNonSplashSwimmingPoolLike(seed) !== isNonSplashSwimmingPoolLike(candidate)) return true;
  if (isLibraryLikePlace(seed) !== isLibraryLikePlace(candidate)) return true;
  if (isSchoolLikePlace(seed) || isSchoolLikePlace(candidate)) return true;
  if (hasFoodOrRetailGoogleType(seed) !== hasFoodOrRetailGoogleType(candidate)) {
    if (hasFoodOrRetailGoogleType(seed) || hasFoodOrRetailGoogleType(candidate)) return true;
  }
  return false;
}

/**
 * Finds clusters of nearby places with shared name prefixes and merges them.
 * @param {string} regionKey - e.g. "omaha-ne"
 * @param {Object} options - { distanceMeters: 100, dryRun: false }
 * @returns {Promise<{ merged: number, archived: number, clusters: Array|number }>}
 */
async function proximityDedup(regionKey, options = {}) {
  const { distanceMeters = 100, dryRun = false } = options;
  const db = getDb();

  const places = await db.collection('playgrounds')
    .find(playgroundsInMergeRegion(regionKey))
    .toArray();

  // Build clusters using spatial proximity + name prefix matching
  const visited = new Set();
  const clusters = [];

  for (const place of places) {
    const placeId = String(place._id);
    if (visited.has(placeId)) continue;
    if (!hasTrustworthyCoordinatesForMerge(place)) continue;

    const prefix = extractNamePrefix(place.name);

    const cluster = [place];
    visited.add(placeId);

    for (const candidate of places) {
      const candidateId = String(candidate._id);
      if (visited.has(candidateId)) continue;
      if (!hasTrustworthyCoordinatesForMerge(candidate)) continue;

      const dist = haversineMeters(
        place.location.coordinates[1], place.location.coordinates[0],
        candidate.location.coordinates[1], candidate.location.coordinates[0]
      );

      // Exact-location duplicates (< 10m): still reject obvious category mismatches
      if (dist <= 10) {
        if (proximityDedupPairIncompatible(place, candidate)) continue;
        const candPrefix = extractNamePrefix(candidate.name);
        if (prefix && candPrefix && prefix !== candPrefix && !hasSharedSignificantToken(place, candidate)) {
          continue;
        }
        cluster.push(candidate);
        visited.add(candidateId);
        continue;
      }

      // Name-prefix + proximity clustering (original logic)
      if (!prefix) continue;
      const candidatePrefix = extractNamePrefix(candidate.name);
      if (!candidatePrefix || candidatePrefix !== prefix) continue;

      if (dist <= distanceMeters) {
        if (proximityDedupPairIncompatible(place, candidate)) continue;
        cluster.push(candidate);
        visited.add(candidateId);
      }
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }

  // Dry run — return preview without database changes
  if (dryRun) {
    return {
      merged: 0,
      archived: 0,
      clusters: clusters.map(c => ({
        winner: selectWinner(c).name,
        members: c.map(p => p.name),
        count: c.length,
      })),
    };
  }

  // Execute merges
  let totalMerged = 0;
  let totalArchived = 0;

  for (const cluster of clusters) {
    const winner = selectWinner(cluster);
    const losers = cluster.filter(p => String(p._id) !== String(winner._id));
    const merged = mergeFields(winner, losers);

    // Update winner with merged fields + mergeInfo
    await db.collection('playgrounds').updateOne(
      { _id: winner._id },
      {
        $set: {
          ...merged,
          mergeInfo: {
            mergedFrom: losers.map(l => l._id),
            mergeType: 'proximity_dedup',
            mergedAt: new Date(),
            mergedBy: 'system',
          },
        },
      }
    );

    // Archive losers
    const archiveDocs = losers.map(l => ({
      ...l,
      archiveInfo: {
        reason: 'proximity_dedup',
        mergedIntoId: winner._id,
        archivedAt: new Date(),
        archivedBy: 'system',
      },
    }));

    if (archiveDocs.length > 0) {
      // Use ordered:false so already-archived docs (dup key) are skipped without aborting
      try {
        await db.collection('archived_playgrounds').insertMany(archiveDocs, { ordered: false });
      } catch (bulkErr) {
        // E11000 duplicate key errors are expected if a place was already archived — ignore them
        if (!bulkErr.code || bulkErr.code !== 11000) {
          const writeErrors = bulkErr.writeErrors || [];
          const nonDupErrors = writeErrors.filter(e => e.code !== 11000);
          if (nonDupErrors.length > 0) throw bulkErr;
        }
      }
      await db.collection('playgrounds').deleteMany({
        _id: { $in: losers.map(l => l._id) },
      });
    }

    totalMerged++;
    totalArchived += losers.length;
  }

  return { merged: totalMerged, archived: totalArchived, clusters: clusters.length };
}

function docToSubvenueStub(doc) {
  return {
    id: doc._id,
    name: doc.name,
    playgroundType: doc.playgroundType,
    features: [
      ...(doc.equipment || []),
      ...(doc.sportsCourts || []),
    ],
    equipment: doc.equipment || [],
    originalGooglePlaceId: doc.googlePlaceId,
  };
}

/** Flatten absorbed children plus any subVenues already on those docs; dedupe by id. */
function buildSubvenuesFromAbsorbedChildren(children) {
  const seen = new Set();
  const rows = [];
  for (const child of children) {
    const cid = String(child._id);
    if (seen.has(cid)) continue;
    seen.add(cid);
    rows.push(docToSubvenueStub(child));
    for (const sv of child.subVenues || []) {
      const sid = sv.id != null ? String(sv.id) : '';
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      rows.push({
        id: sv.id,
        name: sv.name,
        playgroundType: sv.playgroundType,
        features: sv.features || [
          ...((sv.equipment) || []),
        ],
        equipment: sv.equipment || [],
        originalGooglePlaceId: sv.originalGooglePlaceId,
      });
    }
  }
  return rows;
}

function dedupeSubvenueRowsById(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const id = r.id != null ? String(r.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

/**
 * Merges a group into one parent with subVenues; archives and deletes children.
 * @param {import('mongodb').Db} db
 * @param {Object[]} group
 * @param {{ mergeType?: string, mergedBy?: string }} [options]
 * @returns {Promise<{ parentId: import('mongodb').ObjectId, childCount: number }|null>}
 */
async function absorbSubvenueGroup(db, group, options = {}) {
  const {
    mergeType = 'subvenue_group',
    mergedBy = 'system',
    normalizedAddressKey: optNormKey,
  } = options;
  if (!group || group.length < 2) return null;

  const parent =
    mergeType === 'subvenue_campus'
      ? selectCampusClusterParent(group)
      : mergeType === 'subvenue_park'
        ? selectParkClusterParent(group)
      : selectWinner(group);
  let children = group.filter((p) => String(p._id) !== String(parent._id));
  if (mergeType === 'subvenue_campus' && hasValidLocation(parent)) {
    const plng = parent.location.coordinates[0];
    const plat = parent.location.coordinates[1];
    children = [...children].sort((a, b) => {
      const da = hasValidLocation(a)
        ? haversineMeters(plat, plng, a.location.coordinates[1], a.location.coordinates[0])
        : Number.POSITIVE_INFINITY;
      const dbM = hasValidLocation(b)
        ? haversineMeters(plat, plng, b.location.coordinates[1], b.location.coordinates[0])
        : Number.POSITIVE_INFINITY;
      if (da !== dbM) return da - dbM;
      return String(a._id).localeCompare(String(b._id));
    });
  }

  const fromParent = parent.subVenues || [];
  const fromChildren = buildSubvenuesFromAbsorbedChildren(children);
  const subVenues = dedupeSubvenueRowsById([...fromParent, ...fromChildren]);

  const merged = mergeFields(parent, children);

  const normalizedAddressKey =
    mergeType === 'subvenue_group'
      ? (optNormKey || inferGroupNormalizedAddressKey(group) || undefined)
      : undefined;

  const mergeInfo = {
    mergedFrom: children.map((c) => c._id),
    mergeType,
    mergedAt: new Date(),
    mergedBy,
    ...(normalizedAddressKey ? { normalizedAddressKey } : {}),
  };

  await db.collection('playgrounds').updateOne(
    { _id: parent._id },
    {
      $set: {
        ...merged,
        subVenues,
        mergeInfo,
      },
    }
  );

  const archiveDocs = children.map((c) => ({
    ...c,
    archiveInfo: {
      reason: 'subvenue_absorbed',
      mergedIntoId: parent._id,
      archivedAt: new Date(),
      archivedBy: mergedBy,
    },
  }));

  if (archiveDocs.length > 0) {
    try {
      await db.collection('archived_playgrounds').insertMany(archiveDocs, { ordered: false });
    } catch (bulkErr) {
      if (!bulkErr.code || bulkErr.code !== 11000) {
        const writeErrors = bulkErr.writeErrors || [];
        if (writeErrors.filter((e) => e.code !== 11000).length > 0) throw bulkErr;
      }
    }
    await db.collection('playgrounds').deleteMany({
      _id: { $in: children.map((c) => c._id) },
    });
  }

  return { parentId: parent._id, childCount: children.length };
}

// ─── Task 2.2: detectAndGroupSubVenues ───────────────────────────────────────
/**
 * Auto-detects sub-venue relationships: (1) campus-scale zoo/aquarium/museum clusters
 * by proximity + name/type signals, (2) park amenity clusters, then
 * (3) normalized address + 50m proximity fallback.
 * @param {string} regionKey
 * @returns {Promise<{ grouped: number, campusGrouped: number, parents: Array }>}
 *   `grouped` = address-based merges; `campusGrouped` = campus anchor merges; `parents` = all parent ids (campus first).
 */
async function detectAndGroupSubVenues(regionKey) {
  const db = getDb();

  let places = await db.collection('playgrounds')
    .find(playgroundsInMergeRegion(regionKey))
    .toArray();

  // Campus / large-venue clustering first (exhibits that do not share street addresses)
  const campusClusters = buildCampusClusters(places);
  let campusGrouped = 0;
  const campusParents = [];
  for (const cluster of campusClusters) {
    const result = await absorbSubvenueGroup(db, cluster, {
      mergeType: 'subvenue_campus',
      mergedBy: 'system',
    });
    if (result) {
      campusGrouped++;
      campusParents.push(result.parentId);
    }
  }

  if (campusGrouped > 0) {
    places = await db.collection('playgrounds')
      .find(playgroundsInMergeRegion(regionKey))
      .toArray();
  }

  const parkClusters = buildParkAmenityClusters(places);
  let parkGrouped = 0;
  const parkParents = [];
  for (const cluster of parkClusters) {
    const result = await absorbSubvenueGroup(db, cluster, {
      mergeType: 'subvenue_park',
      mergedBy: 'system',
    });
    if (result) {
      parkGrouped++;
      parkParents.push(result.parentId);
    }
  }

  if (parkGrouped > 0) {
    places = await db.collection('playgrounds')
      .find(playgroundsInMergeRegion(regionKey))
      .toArray();
  }

  const addressClusters = buildAddressSubvenueGroups(places);

  // Process groups with ≥2 entries
  let grouped = 0;
  const parents = [];

  for (const group of addressClusters) {
    const normalizedAddressKey = inferGroupNormalizedAddressKey(group);
    const result = await absorbSubvenueGroup(db, group, {
      mergeType: 'subvenue_group',
      mergedBy: 'system',
      normalizedAddressKey: normalizedAddressKey || undefined,
    });
    if (result) {
      parents.push(result.parentId);
      grouped++;
    }
  }

  return {
    grouped,
    campusGrouped,
    parkGrouped,
    parents: [...campusParents, ...parkParents, ...parents],
  };
}

/** Largest great-circle distance between any two points (trustworthy coords only). */
function maxPairwiseHaversineMeters(places) {
  const pts = places.filter(hasTrustworthyCoordinatesForMerge);
  if (pts.length < 2) return 0;
  let maxD = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = haversineMeters(
        pts[i].location.coordinates[1], pts[i].location.coordinates[0],
        pts[j].location.coordinates[1], pts[j].location.coordinates[0],
      );
      if (d > maxD) maxD = d;
    }
  }
  return maxD;
}

/**
 * Union connected indices in `bucket` when pairwise distance ≤ maxDistanceMeters (valid locations only).
 * @returns {Object[][]} components of length ≥ 2
 */
function spatialComponentsWithinBucket(bucket, maxDistanceMeters) {
  const n = bucket.length;
  const uf = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    if (uf[x] !== x) uf[x] = find(uf[x]);
    return uf[x];
  }
  function unite(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) uf[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    if (!hasTrustworthyCoordinatesForMerge(bucket[i])) continue;
    for (let j = i + 1; j < n; j++) {
      if (!hasTrustworthyCoordinatesForMerge(bucket[j])) continue;
      const dist = haversineMeters(
        bucket[i].location.coordinates[1],
        bucket[i].location.coordinates[0],
        bucket[j].location.coordinates[1],
        bucket[j].location.coordinates[0],
      );
      if (dist <= maxDistanceMeters) unite(i, j);
    }
  }

  const compMap = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!compMap.has(r)) compMap.set(r, []);
    compMap.get(r).push(bucket[i]);
  }
  return [...compMap.values()].filter((c) => c.length >= 2);
}

/**
 * Merge duplicate venues that appear under different `regionKey`s (e.g. border of two seeded cities).
 * Buckets by normalized address (≥3 tokens), then merges spatially connected sets where
 * at least two distinct region keys exist (default). Winner keeps its regionKey and absorbs losers.
 *
 * @param {Object} options
 * @param {boolean} [options.dryRun=false]
 * @param {number} [options.maxDistanceMeters=150]
 * @param {boolean} [options.requireDistinctRegions=true] If false, merges any same-address cluster (aggressive).
 */
async function crossRegionAddressDedup(options = {}) {
  const {
    dryRun = false,
    maxDistanceMeters = 150,
    requireDistinctRegions = true,
  } = options;

  const db = getDb();
  const places = await db.collection('playgrounds')
    .find({ archivedAt: { $exists: false } })
    .toArray();

  const addressBuckets = new Map();
  for (const p of places) {
    if (!p.address) continue;
    const norm = normalizeAddress(p.address);
    const wc = norm.split(' ').filter((w) => w.length > 0).length;
    if (wc < 3) continue;
    if (!addressBuckets.has(norm)) addressBuckets.set(norm, []);
    addressBuckets.get(norm).push(p);
  }

  const componentsToMerge = [];
  /** Same-address duplicates should be within walking distance; kills bogus groups (bad coords, long UF chains). */
  const spanCapMeters = Math.min(50_000, Math.max(500, maxDistanceMeters * 200));
  for (const [, bucket] of addressBuckets) {
    if (bucket.length < 2) continue;
    const components = spatialComponentsWithinBucket(bucket, maxDistanceMeters);
    for (const comp of components) {
      const keys = new Set(comp.map((p) => p.regionKey).filter(Boolean));
      if (requireDistinctRegions && keys.size < 2) continue;
      if (maxPairwiseHaversineMeters(comp) > spanCapMeters) continue;
      componentsToMerge.push(comp);
    }
  }

  if (dryRun) {
    return {
      merged: 0,
      archived: 0,
      clusterCount: componentsToMerge.length,
      clusters: componentsToMerge.map((c) => {
        const winner = selectWinner(c);
        return {
          winner: winner.name,
          members: c.map((p) => p.name),
          regionKeys: [...new Set(c.map((p) => p.regionKey).filter(Boolean))],
          count: c.length,
        };
      }),
    };
  }

  let totalMerged = 0;
  let totalArchived = 0;

  for (const cluster of componentsToMerge) {
    const winner = selectWinner(cluster);
    const losers = cluster.filter((p) => String(p._id) !== String(winner._id));
    const merged = mergeFields(winner, losers);
    const normKey = inferGroupNormalizedAddressKey(cluster) || undefined;
    const subVenues = dedupeSubvenueRowsById([
      ...(winner.subVenues || []),
      ...losers.flatMap((l) => l.subVenues || []),
    ]);
    const coveredRegionKeys = [
      ...new Set(cluster.map((p) => p.regionKey).filter(Boolean)),
    ];

    await db.collection('playgrounds').updateOne(
      { _id: winner._id },
      {
        $set: {
          ...merged,
          ...(subVenues.length > 0 ? { subVenues } : {}),
          ...(coveredRegionKeys.length > 0 ? { coveredRegionKeys } : {}),
          mergeInfo: {
            mergedFrom: losers.map((l) => l._id),
            mergeType: 'cross_region_address',
            mergedAt: new Date(),
            mergedBy: 'system',
            ...(normKey ? { normalizedAddressKey: normKey } : {}),
          },
        },
      },
    );

    const archiveDocs = losers.map((l) => ({
      ...l,
      archiveInfo: {
        reason: 'cross_region_address',
        mergedIntoId: winner._id,
        archivedAt: new Date(),
        archivedBy: 'system',
      },
    }));

    if (archiveDocs.length > 0) {
      try {
        await db.collection('archived_playgrounds').insertMany(archiveDocs, { ordered: false });
      } catch (bulkErr) {
        if (!bulkErr.code || bulkErr.code !== 11000) {
          const writeErrors = bulkErr.writeErrors || [];
          if (writeErrors.filter((e) => e.code !== 11000).length > 0) throw bulkErr;
        }
      }
      await db.collection('playgrounds').deleteMany({
        _id: { $in: losers.map((l) => l._id) },
      });
    }

    totalMerged += 1;
    totalArchived += losers.length;
  }

  return {
    merged: totalMerged,
    archived: totalArchived,
    clusterCount: componentsToMerge.length,
  };
}

/**
 * Canonical venue pass: group distinct subvenues first, then merge true duplicates,
 * then remove same-address duplicates that crossed region boundaries.
 * This is intentionally the single entry point used by seed/refresh paths.
 *
 * @param {string} regionKey
 * @param {{ distanceMeters?: number, runCrossRegion?: boolean }} [options]
 */
async function canonicalizeRegionVenues(regionKey, options = {}) {
  const distanceMeters = options.distanceMeters || parseInt(process.env.VENUE_DEDUP_DISTANCE_M || '100', 10);
  const runCrossRegion = options.runCrossRegion !== false;

  const grouping = await detectAndGroupSubVenues(regionKey);
  const dedup = await proximityDedup(regionKey, { distanceMeters });
  const crossRegion = runCrossRegion
    ? await crossRegionAddressDedup({
      maxDistanceMeters: parseInt(process.env.VENUE_CROSS_REGION_DISTANCE_M || '150', 10),
      requireDistinctRegions: true,
    })
    : null;

  return { grouping, dedup, crossRegion };
}

// ─── Task 3.1: linkSubVenues ─────────────────────────────────────────────────
/**
 * Manually links child venues under a parent.
 * Appends to existing subVenues, applies additive merge, archives children.
 * Skips missing children gracefully; throws if parent not found.
 * @param {string} parentId - playground _id of the parent
 * @param {string[]} childIds - playground _ids to absorb as sub-venues
 * @returns {Promise<{ parent: string, subVenueCount: number }>}
 */
async function linkSubVenues(parentId, childIds) {
  const db = getDb();

  const parent = await db.collection('playgrounds').findOne({ _id: parentId });
  if (!parent) throw new Error(`Parent ${parentId} not found`);

  const children = await db.collection('playgrounds')
    .find({ _id: { $in: childIds } })
    .toArray();

  // Skip missing children gracefully — only process found ones
  if (children.length === 0) {
    return { parent: parentId, subVenueCount: (parent.subVenues || []).length };
  }

  const existingSubVenues = parent.subVenues || [];
  const newSubVenues = children.map(child => ({
    id: child._id,
    name: child.name,
    playgroundType: child.playgroundType,
    features: [
      ...(child.equipment || []),
      ...(child.sportsCourts || []),
    ],
    equipment: child.equipment || [],
    originalGooglePlaceId: child.googlePlaceId,
  }));

  const merged = mergeFields(parent, children);
  const foundChildIds = children.map(c => c._id);

  const inferredKey = inferGroupNormalizedAddressKey([parent, ...children]);
  const normalizedAddressKey =
    inferredKey ||
    parent.mergeInfo?.normalizedAddressKey ||
    undefined;

  await db.collection('playgrounds').updateOne(
    { _id: parentId },
    {
      $set: {
        ...merged,
        subVenues: [...existingSubVenues, ...newSubVenues],
        mergeInfo: {
          mergedFrom: [
            ...(parent.mergeInfo?.mergedFrom || []),
            ...foundChildIds,
          ],
          mergeType: 'subvenue_group',
          mergedAt: new Date(),
          mergedBy: 'admin',
          ...(normalizedAddressKey ? { normalizedAddressKey } : {}),
        },
      },
    }
  );

  // Archive children
  const archiveDocs = children.map(c => ({
    ...c,
    archiveInfo: {
      reason: 'subvenue_absorbed',
      mergedIntoId: parentId,
      archivedAt: new Date(),
      archivedBy: 'admin',
    },
  }));

  if (archiveDocs.length > 0) {
    try {
      await db.collection('archived_playgrounds').insertMany(archiveDocs, { ordered: false });
    } catch (bulkErr) {
      if (!bulkErr.code || bulkErr.code !== 11000) {
        const writeErrors = bulkErr.writeErrors || [];
        if (writeErrors.filter(e => e.code !== 11000).length > 0) throw bulkErr;
      }
    }
    await db.collection('playgrounds').deleteMany({
      _id: { $in: foundChildIds },
    });
  }

  return { parent: parentId, subVenueCount: existingSubVenues.length + newSubVenues.length };
}

// ─── Task 3.2: unlinkSubVenue ────────────────────────────────────────────────
/**
 * Restores a child from archived_playgrounds to playgrounds (stripping archiveInfo),
 * removes from parent's subVenues and mergeInfo.mergedFrom, deletes from archive.
 * Throws if archived child not found.
 * @param {string} parentId
 * @param {string} childId - the archived sub-venue to restore
 * @returns {Promise<{ restored: Object }>}
 */
async function unlinkSubVenue(parentId, childId) {
  const db = getDb();

  const archived = await db.collection('archived_playgrounds').findOne({ _id: childId });
  if (!archived) throw new Error(`Archived venue ${childId} not found`);

  // Restore to playgrounds (strip archiveInfo)
  const { archiveInfo, ...originalDoc } = archived;
  await db.collection('playgrounds').insertOne(originalDoc);
  await db.collection('archived_playgrounds').deleteOne({ _id: childId });

  // Remove from parent's subVenues array and mergeInfo.mergedFrom
  await db.collection('playgrounds').updateOne(
    { _id: parentId },
    {
      $pull: {
        subVenues: { id: childId },
        'mergeInfo.mergedFrom': childId,
      },
    }
  );

  return { restored: originalDoc };
}

/**
 * Ops / QA: strip merge metadata so campus + dedup passes can be re-run from a clean graph.
 *
 * 1) Sets `subVenues: []` and removes `mergeInfo` on playgrounds (scoped by region or entire DB).
 * 2) Re-inserts every matching `archived_playgrounds` row into `playgrounds` (same `_id`),
 *    then deletes it from the archive. If that `_id` is already live, only the archive row is removed.
 *
 * @param {string} [regionKey] Required unless `options.allRegions` is true.
 * @param {{ confirm: string, allRegions?: boolean }} options
 *   - Region scope: `confirm` must be `"RESET_MERGE_TEST"`.
 *   - Global scope: `allRegions: true`, env `ALLOW_GLOBAL_MERGE_RESET=1`, and `confirm` must be `"RESET_MERGE_ALL_DATABASE"`.
 * @returns {Promise<{ scope: string, clearedMatched: number, clearedModified: number, archivedSeen: number, restored: number, archiveRemovedStale: number, restoreErrors: Array<{ id: string, message: string }> }>}
 */
async function bulkResetMergeStateForTesting(regionKey, options = {}) {
  const { confirm, allRegions = false } = options || {};
  const db = getDb();

  let playgroundFilter;
  let archiveFilter;
  let scope;

  if (allRegions) {
    const allow =
      process.env.ALLOW_GLOBAL_MERGE_RESET === '1' ||
      process.env.ALLOW_GLOBAL_MERGE_RESET === 'true';
    if (!allow) {
      throw new Error('allRegions requires env ALLOW_GLOBAL_MERGE_RESET=1');
    }
    if (confirm !== 'RESET_MERGE_ALL_DATABASE') {
      throw new Error('Invalid confirm; for allRegions use confirm: "RESET_MERGE_ALL_DATABASE"');
    }
    playgroundFilter = {};
    archiveFilter = {};
    scope = 'all_regions';
  } else {
    if (confirm !== 'RESET_MERGE_TEST') {
      throw new Error('Invalid confirm; pass confirm: "RESET_MERGE_TEST"');
    }
    if (!regionKey || typeof regionKey !== 'string') {
      throw new Error('regionKey is required unless allRegions is true');
    }
    playgroundFilter = { regionKey };
    archiveFilter = { regionKey };
    scope = `region:${regionKey}`;
  }

  const clearRes = await db.collection('playgrounds').updateMany(playgroundFilter, {
    $set: { subVenues: [] },
    $unset: { mergeInfo: '' },
  });

  const archived = await db.collection('archived_playgrounds').find(archiveFilter).toArray();
  let restored = 0;
  let archiveRemovedStale = 0;
  /** @type {Array<{ id: string, message: string }>} */
  const restoreErrors = [];

  for (const arch of archived) {
    const { archiveInfo: _archiveMeta, ...originalDoc } = arch;
    const existing = await db.collection('playgrounds').findOne(
      { _id: arch._id },
      { projection: { _id: 1 } },
    );
    if (existing) {
      await db.collection('archived_playgrounds').deleteOne({ _id: arch._id });
      archiveRemovedStale += 1;
      continue;
    }
    try {
      await db.collection('playgrounds').insertOne(originalDoc);
      await db.collection('archived_playgrounds').deleteOne({ _id: arch._id });
      restored += 1;
    } catch (e) {
      restoreErrors.push({
        id: String(arch._id),
        message: e && e.message ? e.message : String(e),
      });
    }
  }

  return {
    scope,
    clearedMatched: clearRes.matchedCount,
    clearedModified: clearRes.modifiedCount,
    archivedSeen: archived.length,
    restored,
    archiveRemovedStale,
    restoreErrors,
  };
}

// ─── Task 3.3: Exports ──────────────────────────────────────────────────────
module.exports = {
  extractNamePrefix,
  longestCommonPrefix,
  haversineMeters,
  scorePlace,
  selectWinner,
  mergeFields,
  inferAmenityBooleansFromPlace,
  normalizeAddress,
  proximityDedup,
  canonicalizeRegionVenues,
  detectAndGroupSubVenues,
  crossRegionAddressDedup,
  previewCampusClusters,
  previewParkAmenityClusters,
  previewAddressSubvenueGroups,
  buildAddressSubvenueGroups,
  simulatePlacesAfterCampusMerge,
  linkSubVenues,
  unlinkSubVenue,
  bulkResetMergeStateForTesting,
  getMergeAudit,
  buildCampusClusters,
  selectCampusClusterParent,
  pickHigherScoredCampusParent,
  scoreCampusClusterParent,
  buildParkAmenityClusters,
  isDefaultPlaceholderImageUrl,
  shouldAttachAsCampusChild,
  shouldAttachAsParkChild,
  isCampusAnchorCandidate,
  isPrimaryCampusAnchor,
  isPrimaryParkAnchor,
  hasValidLocation,
};
