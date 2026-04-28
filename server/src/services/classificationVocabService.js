const { getDb } = require('../database');

const DEFAULT_VOCAB = Object.freeze({
    equipment: [
        'Swings', 'Slide', 'Climbing Wall', 'Monkey Bars', 'Sandbox',
        'Seesaw', 'Spring Riders', 'Balance Beam', 'Zip Line',
        'Trampoline', 'Tunnel', 'Merry-Go-Round',
    ],
    swingTypes: ['Belt', 'Bucket', 'Tire', 'Accessible'],
    amenities: [
        'Bathrooms', 'Shade', 'Fenced', 'Picnic Tables', 'Bottle Filler',
        'Benches', 'Trash Cans', 'Parking', 'Splash Pad',
    ],
    groundSurface: ['Grass', 'Rubber', 'Wood Chips', 'Sand', 'Pea Gravel', 'Concrete', 'Turf'],
    sportsCourts: ['Basketball', 'Soccer', 'Tennis', 'Pickleball', 'Volleyball', 'Baseball', 'Football'],
});

const CACHE_TTL_MS = parseInt(process.env.CLASSIFICATION_VOCAB_CACHE_MS || '300000', 10);
let cached = null;
let cachedAt = 0;

function dedupeNormalized(values) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
        const v = String(raw || '').trim();
        if (!v) continue;
        const k = v.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(v);
    }
    return out;
}

function buildFromDoc(doc) {
    if (!doc || typeof doc !== 'object') return null;
    const out = {};
    for (const key of Object.keys(DEFAULT_VOCAB)) {
        const vals = dedupeNormalized(doc[key]);
        if (vals.length > 0) out[key] = vals;
    }
    return Object.keys(out).length > 0 ? out : null;
}

async function getClassificationVocab({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && cached && (now - cachedAt) < CACHE_TTL_MS) {
        return cached;
    }

    try {
        const db = getDb();
        const doc = await db.collection('classification_vocab').findOne({ _id: 'photo_feature_vocab' });
        const fromDb = buildFromDoc(doc);
        cached = { ...DEFAULT_VOCAB, ...(fromDb || {}) };
        cachedAt = now;
        return cached;
    } catch (err) {
        console.warn('[classificationVocab] falling back to defaults:', err.message);
        cached = { ...DEFAULT_VOCAB };
        cachedAt = now;
        return cached;
    }
}

async function upsertClassificationVocab({ updates = {}, actorUserId = null }) {
    const db = getDb();
    const set = {};
    for (const key of Object.keys(DEFAULT_VOCAB)) {
        if (!(key in updates)) continue;
        const vals = dedupeNormalized(updates[key]);
        if (vals.length > 0) set[key] = vals;
    }
    if (Object.keys(set).length === 0) {
        throw new Error('No valid vocab fields to update.');
    }

    set.updatedAt = new Date();
    if (actorUserId) set.updatedBy = actorUserId;

    await db.collection('classification_vocab').updateOne(
        { _id: 'photo_feature_vocab' },
        { $set: set, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
    );

    return getClassificationVocab({ forceRefresh: true });
}

module.exports = {
    DEFAULT_VOCAB,
    getClassificationVocab,
    upsertClassificationVocab,
};
