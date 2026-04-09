const {
    normalizeRegionKey,
    CONTRIBUTION_FIELD_MAP,
    assignLevel,
} = require('../services/contributionService');

describe('normalizeRegionKey', () => {
    test('returns null for empty input', () => {
        expect(normalizeRegionKey(null)).toBeNull();
        expect(normalizeRegionKey(undefined)).toBeNull();
        expect(normalizeRegionKey('')).toBeNull();
        expect(normalizeRegionKey('   ')).toBe('');
    });

    test('lowercases, replaces spaces with underscores, strips punctuation', () => {
        expect(normalizeRegionKey('Omaha')).toBe('omaha');
        expect(normalizeRegionKey('  Austin TX  ')).toBe('austin_tx');
        expect(normalizeRegionKey('St. Louis, MO')).toBe('st_louis_mo');
    });
});

describe('CONTRIBUTION_FIELD_MAP', () => {
    test('every mapped value is non-empty camelCase fragment without underscores', () => {
        for (const [type, field] of Object.entries(CONTRIBUTION_FIELD_MAP)) {
            expect(field.length).toBeGreaterThan(0);
            expect(field).not.toMatch(/_/);
            expect(type).toMatch(/^[A-Z_]+$/);
        }
    });

    test('covers expected submission types', () => {
        expect(CONTRIBUTION_FIELD_MAP.NEW_PLAYGROUND).toBe('newPlaygrounds');
        expect(CONTRIBUTION_FIELD_MAP.PLAYGROUND_EDIT).toBe('edits');
        expect(CONTRIBUTION_FIELD_MAP.PHOTO).toBe('photos');
        expect(CONTRIBUTION_FIELD_MAP.CROWD_REPORT).toBe('reports');
        expect(CONTRIBUTION_FIELD_MAP.ISSUE_REPORT).toBe('reports');
    });
});

describe('assignLevel', () => {
    test('returns correct tier names by score', async () => {
        expect(await assignLevel(0)).toBe('New Explorer');
        expect(await assignLevel(99)).toBe('New Explorer');
        expect(await assignLevel(100)).toBe('Community Helper');
        expect(await assignLevel(499)).toBe('Community Helper');
        expect(await assignLevel(500)).toBe('Local Guide');
        expect(await assignLevel(1499)).toBe('Local Guide');
        expect(await assignLevel(1500)).toBe('Top Contributor');
        expect(await assignLevel(99999)).toBe('Top Contributor');
    });
});
