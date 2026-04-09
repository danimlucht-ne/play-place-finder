const FAST_SEED_SEARCHES = Object.freeze([
  { type: 'park', keyword: 'playground' },
  { type: 'park', keyword: 'play place' },
  { type: 'park' },  // Broad park search - catches parks without specific keywords
  { type: 'amusement_park', keyword: 'kids' },
  { type: 'amusement_center', keyword: 'family' },
  { type: 'mini_golf' },
  { keyword: 'mini golf' },
  { type: 'tourist_attraction', keyword: 'playground' },
  { type: 'primary_school', keyword: 'elementary school' },
  { type: 'museum', keyword: "children's museum" },
  { type: 'library', keyword: 'library' },
  { keyword: 'trampoline park kids' },
  { keyword: 'kids arcade' },
]);

const BACKGROUND_EXPANSION_SEARCHES = Object.freeze([
  { type: 'park', keyword: 'playground' },
  { type: 'park', keyword: 'splash pad' },
  { type: 'park' },  // Broad park search - catches parks without specific keywords
  { type: 'amusement_park', keyword: 'kids' },
  { type: 'amusement_center', keyword: 'family' },
  { type: 'mini_golf' },
  { type: 'museum', keyword: "children's museum" },
  { type: 'museum', keyword: 'science center kids' },
  { type: 'library', keyword: 'library' },
  { type: 'zoo', keyword: 'zoo' },
  { type: 'aquarium', keyword: 'aquarium' },
  { type: 'tourist_attraction', keyword: 'zoo exhibit' },
  { type: 'tourist_attraction', keyword: 'animal exhibit' },
  { type: 'tourist_attraction', keyword: 'children' },
  { type: 'primary_school', keyword: 'elementary school' },
  { keyword: 'trampoline park kids' },
  { keyword: 'kids arcade' },
  { keyword: 'ice skating rink' },
  { keyword: 'skate park' },
  { keyword: 'botanical garden' },
  { keyword: 'swimming pool kids' },
  { keyword: 'mini golf' },
]);

const LIGHT_REFRESH_SEARCHES = Object.freeze([
  { type: 'park', keyword: 'playground' },
  { type: 'park', keyword: 'splash pad' },
  { type: 'park' },  // Broad park search - catches parks without specific keywords
  { type: 'amusement_center', keyword: 'kids' },
  { type: 'museum', keyword: "children's museum" },
  { type: 'library', keyword: 'library' },
  { type: 'zoo', keyword: 'zoo' },
  { type: 'tourist_attraction', keyword: 'zoo exhibit' },
  { keyword: 'indoor playground' },
  { keyword: 'trampoline park kids' },
  { keyword: 'mini golf' },
]);

const CAMPUS_SUBVENUE_SEARCHES = Object.freeze([
  { type: 'tourist_attraction', keyword: 'exhibit' },
  { type: 'tourist_attraction', keyword: 'zoo exhibit' },
  { type: 'tourist_attraction', keyword: 'animal exhibit' },
  { type: 'aquarium', keyword: 'aquarium' },
  { keyword: 'zoo exhibit' },
  { keyword: 'animal exhibit' },
  { keyword: 'habitat' },
  { keyword: 'aviary' },
  { keyword: 'carousel' },
  { keyword: 'splash park zoo' },
  { keyword: 'stingray' },
  { keyword: 'skyfari' },
  { keyword: 'train ride zoo' },
  { type: 'establishment', keyword: 'exhibit' },
  { type: 'point_of_interest', keyword: 'exhibit' },
  { type: 'establishment', keyword: 'habitat' },
  { type: 'point_of_interest', keyword: 'habitat' },
  { type: 'point_of_interest', keyword: 'zoo attraction' },
]);

module.exports = {
  FAST_SEED_SEARCHES,
  BACKGROUND_EXPANSION_SEARCHES,
  LIGHT_REFRESH_SEARCHES,
  CAMPUS_SUBVENUE_SEARCHES,
  DIAGNOSTIC_SEARCHES: FAST_SEED_SEARCHES,
};
