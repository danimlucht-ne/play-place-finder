/**
 * badgeService.js — 9.11
 * Computes quality badges for a playground document.
 *
 * Badge conditions:
 *   WELL_DOCUMENTED   — >= 5 non-null enriched fields AND verificationCount >= 2
 *   COMMUNITY_FAVORITE — favoriteCount >= 10
 *   PHOTO_VERIFIED    — >= 3 approved photos (imageUrls with non-google_photo entries, or approvedPhotoCount field)
 *   HIGHLY_RATED      — rating >= 4.5 AND ratingCount >= 5
 */

const ENRICHED_FIELDS = [
    'hasBathrooms', 'hasShade', 'isFenced', 'hasPicnicTables', 'hasWaterFountain',
    'isToddlerFriendly', 'hasSplashPad', 'isDogFriendly', 'hasWalkingTrail', 'hasParking',
    'groundType', 'playgroundType', 'description', 'address', 'ageRange'
];

const BADGES = {
    WELL_DOCUMENTED: 'WELL_DOCUMENTED',
    COMMUNITY_FAVORITE: 'COMMUNITY_FAVORITE',
    PHOTO_VERIFIED: 'PHOTO_VERIFIED',
    HIGHLY_RATED: 'HIGHLY_RATED',
};

/**
 * Computes the badge set for a playground document.
 * @param {object} playground - The playground document from MongoDB.
 * @returns {string[]} Array of badge strings (subset of BADGES values).
 */
function computeBadges(playground) {
    const badges = [];

    // WELL_DOCUMENTED: >= 5 non-null enriched fields AND verificationCount >= 2
    const nonNullEnrichedCount = ENRICHED_FIELDS.filter(f => playground[f] !== null && playground[f] !== undefined && playground[f] !== '').length;
    if (nonNullEnrichedCount >= 5 && (playground.verificationCount || 0) >= 2) {
        badges.push(BADGES.WELL_DOCUMENTED);
    }

    // COMMUNITY_FAVORITE: favoriteCount >= 10
    if ((playground.favoriteCount || 0) >= 10) {
        badges.push(BADGES.COMMUNITY_FAVORITE);
    }

    // PHOTO_VERIFIED: >= 3 approved photos
    const approvedPhotoCount = playground.approvedPhotoCount
        ?? (playground.imageUrls || []).filter(u => u && !u.startsWith('google_photo:')).length;
    if (approvedPhotoCount >= 3) {
        badges.push(BADGES.PHOTO_VERIFIED);
    }

    // HIGHLY_RATED: rating >= 4.5 AND ratingCount >= 5
    if ((playground.rating || 0) >= 4.5 && (playground.ratingCount || 0) >= 5) {
        badges.push(BADGES.HIGHLY_RATED);
    }

    return badges;
}

module.exports = { computeBadges, BADGES };
