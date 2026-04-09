const { inferPlaygroundType } = require('../services/inferPlaygroundType');

describe('inferPlaygroundType', () => {
    test('swimming pool in name without Google swimming_pool type', () => {
        expect(inferPlaygroundType(['park', 'point_of_interest'], 'Westside Swimming Pool')).toBe(
            'Pool / Water Park'
        );
    });

    test('Google swimming_pool type', () => {
        expect(inferPlaygroundType(['swimming_pool', 'establishment'], 'Aquatics')).toBe('Pool / Water Park');
    });

    test('splash pad wins over generic pool / aquatic wording', () => {
        expect(inferPlaygroundType(['park'], 'Lincoln Spray Park')).toBe('Splash Pad');
        expect(inferPlaygroundType(['park'], 'Cool Splash Pad')).toBe('Splash Pad');
    });

    test('canonical museum / zoo strings for app mapping', () => {
        expect(inferPlaygroundType(['museum'], 'Discovery Center')).toBe('Museum / Science Center');
        expect(inferPlaygroundType(['zoo'], 'City Zoo')).toBe('Zoo / Aquarium');
        expect(inferPlaygroundType(['aquarium'], 'Touch Tank')).toBe('Zoo / Aquarium');
    });

    test('skate park vs ice rink', () => {
        expect(inferPlaygroundType(['park'], 'Wheel Park Skate Park')).toBe('Skate Park');
        expect(inferPlaygroundType(['skate_park'], 'SPK')).toBe('Skate Park');
        expect(inferPlaygroundType([], 'Memorial Ice Rink')).toBe('Ice Skating Rink');
    });

    test('generic park falls back to Public Park', () => {
        expect(inferPlaygroundType(['park'], 'Riverside Park')).toBe('Public Park');
    });

    test('private dog park in name maps to Private Park', () => {
        expect(inferPlaygroundType(['park'], 'Bark Park Omaha - Private Dog Park')).toBe('Private Park');
    });

    test('natatorium and aquatic center', () => {
        expect(inferPlaygroundType(['establishment'], 'Central Natatorium')).toBe('Pool / Water Park');
        expect(inferPlaygroundType([], 'YMCA Aquatic Center')).toBe('Pool / Water Park');
    });
});
