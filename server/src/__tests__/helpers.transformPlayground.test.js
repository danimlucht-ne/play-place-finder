const { transformPlayground } = require('../utils/helpers');

describe('transformPlayground', () => {
    const prevBase = process.env.SERVER_BASE_URL;
    const prevKey = process.env.GOOGLE_MAPS_API_KEY;

    afterEach(() => {
        process.env.SERVER_BASE_URL = prevBase;
        process.env.GOOGLE_MAPS_API_KEY = prevKey;
    });

    test('prefixes relative image paths with SERVER_BASE_URL', () => {
        process.env.SERVER_BASE_URL = 'https://api.example.com';
        process.env.GOOGLE_MAPS_API_KEY = 'testkey';
        const p = {
            _id: { toString: () => 'abc123' },
            location: { type: 'Point', coordinates: [-95.99, 41.25] },
            imageUrls: ['uploads/photos/x.jpg', '/uploads/y.png'],
        };
        const t = transformPlayground(p);
        expect(t.id).toBe('abc123');
        expect(t.latitude).toBe(41.25);
        expect(t.longitude).toBe(-95.99);
        expect(t.imageUrls[0]).toBe('https://api.example.com/uploads/photos/x.jpg');
        expect(t.imageUrls[1]).toBe('https://api.example.com/uploads/y.png');
    });

    test('uses localhost default when SERVER_BASE_URL unset', () => {
        delete process.env.SERVER_BASE_URL;
        process.env.GOOGLE_MAPS_API_KEY = 'k';
        const p = {
            _id: { toString: () => 'id' },
            imageUrls: ['rel.jpg'],
        };
        const t = transformPlayground(p);
        expect(t.imageUrls[0]).toBe('http://localhost:8000/rel.jpg');
    });

    test('passes through http(s) and data URLs unchanged', () => {
        process.env.SERVER_BASE_URL = 'https://x.com';
        process.env.GOOGLE_MAPS_API_KEY = 'k';
        const p = {
            _id: { toString: () => 'id' },
            imageUrls: ['https://cdn.example.com/a.jpg', 'data:image/png;base64,xxx'],
        };
        const t = transformPlayground(p);
        expect(t.imageUrls[0]).toBe('https://cdn.example.com/a.jpg');
        expect(t.imageUrls[1]).toBe('data:image/png;base64,xxx');
    });

    test('expands google_photo references', () => {
        process.env.SERVER_BASE_URL = 'https://x.com';
        process.env.GOOGLE_MAPS_API_KEY = 'MYKEY';
        const p = {
            _id: { toString: () => 'id' },
            imageUrls: ['google_photo:REF123'],
        };
        const t = transformPlayground(p);
        expect(t.imageUrls[0]).toContain('photoreference=REF123');
        expect(t.imageUrls[0]).toContain('key=MYKEY');
    });

    test('drops google_photo refs when GOOGLE_MAPS_API_KEY is missing', () => {
        process.env.SERVER_BASE_URL = 'https://x.com';
        delete process.env.GOOGLE_MAPS_API_KEY;
        const p = {
            _id: { toString: () => 'id' },
            imageUrls: ['google_photo:REF123'],
        };
        const t = transformPlayground(p);
        expect(t.imageUrls).toEqual([]);
    });

    test('empty imageUrls when absent', () => {
        process.env.SERVER_BASE_URL = 'https://x.com';
        const p = { _id: { toString: () => 'id' } };
        const t = transformPlayground(p);
        expect(t.imageUrls).toEqual([]);
    });

    test('stringifies subVenues ids for clients', () => {
        process.env.SERVER_BASE_URL = 'https://x.com';
        process.env.GOOGLE_MAPS_API_KEY = 'k';
        const p = {
            _id: { toString: () => 'parent1' },
            subVenues: [
                { id: { toString: () => 'childA' }, name: 'Exhibit A', playgroundType: 'Zoo exhibit', features: [], equipment: [] },
            ],
        };
        const t = transformPlayground(p);
        expect(t.subVenues).toHaveLength(1);
        expect(t.subVenues[0].id).toBe('childA');
        expect(t.subVenues[0].name).toBe('Exhibit A');
    });

    test('maps legacy hasWaterFountain to hasBottleFiller and omits old key', () => {
        process.env.SERVER_BASE_URL = 'https://x.com';
        const p = {
            _id: { toString: () => 'id' },
            hasWaterFountain: true,
        };
        const t = transformPlayground(p);
        expect(t.hasBottleFiller).toBe(true);
        expect(t.hasWaterFountain).toBeUndefined();
    });
});
