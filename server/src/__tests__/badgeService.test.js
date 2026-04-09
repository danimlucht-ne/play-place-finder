const { computeBadges, BADGES } = require('../services/badgeService');

describe('computeBadges', () => {
    test('empty playground yields no badges', () => {
        expect(computeBadges({})).toEqual([]);
    });

    test('WELL_DOCUMENTED when enough enriched fields and verifications', () => {
        const p = {
            hasBathrooms: true,
            hasShade: true,
            isFenced: true,
            hasPicnicTables: true,
            groundType: 'Rubber',
            verificationCount: 2,
        };
        const badges = computeBadges(p);
        expect(badges).toContain(BADGES.WELL_DOCUMENTED);
    });

    test('COMMUNITY_FAVORITE when favoriteCount high enough', () => {
        expect(computeBadges({ favoriteCount: 10 })).toContain(BADGES.COMMUNITY_FAVORITE);
        expect(computeBadges({ favoriteCount: 9 })).not.toContain(BADGES.COMMUNITY_FAVORITE);
    });

    test('PHOTO_VERIFIED from approvedPhotoCount', () => {
        expect(computeBadges({ approvedPhotoCount: 3 })).toContain(BADGES.PHOTO_VERIFIED);
        expect(computeBadges({ approvedPhotoCount: 2 })).not.toContain(BADGES.PHOTO_VERIFIED);
    });

    test('PHOTO_VERIFIED counts non-google imageUrls (three user photos)', () => {
        const p = {
            imageUrls: ['a.jpg', 'b.jpg', 'c.jpg', 'google_photo:x'],
        };
        expect(computeBadges(p)).toContain(BADGES.PHOTO_VERIFIED);
    });

    test('HIGHLY_RATED when rating and count thresholds met', () => {
        expect(computeBadges({ rating: 4.5, ratingCount: 5 })).toContain(BADGES.HIGHLY_RATED);
        expect(computeBadges({ rating: 4.4, ratingCount: 5 })).not.toContain(BADGES.HIGHLY_RATED);
        expect(computeBadges({ rating: 4.5, ratingCount: 4 })).not.toContain(BADGES.HIGHLY_RATED);
    });

    test('idempotent for same document', () => {
        const p = {
            hasBathrooms: true,
            hasShade: true,
            isFenced: true,
            hasPicnicTables: true,
            playgroundType: 'Public',
            verificationCount: 3,
            favoriteCount: 10,
            rating: 5,
            ratingCount: 10,
            approvedPhotoCount: 3,
        };
        expect(computeBadges(p)).toEqual(computeBadges(p));
    });

    test('only returns known badge strings', () => {
        const p = {
            hasBathrooms: true,
            hasShade: true,
            isFenced: true,
            hasPicnicTables: true,
            description: 'x',
            verificationCount: 5,
            favoriteCount: 99,
            approvedPhotoCount: 5,
            rating: 5,
            ratingCount: 99,
        };
        const allowed = new Set(Object.values(BADGES));
        for (const b of computeBadges(p)) {
            expect(allowed.has(b)).toBe(true);
        }
    });
});
