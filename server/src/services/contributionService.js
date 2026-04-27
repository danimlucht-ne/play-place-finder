const { ObjectId } = require('mongodb');
const { getDb } = require('../database');

// 5.1 — derive a stable region key from a city string
function normalizeRegionKey(city) {
    if (!city) return null;
    return city.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

const CONTRIBUTION_POINTS = {
    PHOTO: 10,
    NEW_PLAYGROUND: 50,
    PLAYGROUND_EDIT: 20,
    CROWD_REPORT: 5,
    ISSUE_REPORT: 10,
    /** Admin-approved new equipment / amenity / ground label from the suggestions queue. */
    SUGGESTION_APPROVED: 100,
    // Add more types as needed
};

const CONTRIBUTION_FIELD_MAP = {
    NEW_PLAYGROUND: 'newPlaygrounds',
    PLAYGROUND_EDIT: 'edits',
    PHOTO: 'photos',
    CROWD_REPORT: 'reports',
    ISSUE_REPORT: 'reports',
    SUGGESTION_APPROVED: 'suggestions',
};

const CONTRIBUTOR_LEVELS = [
    { name: "New Explorer", minScore: 0 },
    { name: "Community Helper", minScore: 100 },
    { name: "Local Guide", minScore: 500 },
    { name: "Top Contributor", minScore: 1500 },
    // Define your levels and score thresholds
];

async function getUser(userId) {
    const db = getDb();
    let user = await db.collection('users').findOne({ _id: userId });
    if (!user) {
        // Create a basic user profile if it doesn't exist
        user = {
            _id: userId,
            email: userId, // Placeholder, will be updated with actual email from Firebase
            contributions: {
                total: 0,
                photos: 0,
                newPlaygrounds: 0,
                edits: 0,
                reports: 0,
                suggestions: 0,
            },
            score: 0,
            level: CONTRIBUTOR_LEVELS[0].name,
            city: null, // Can be set from user's location data during first contribution
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await db.collection('users').insertOne(user);
    }
    return user;
}

async function assignLevel(score) {
    for (let i = CONTRIBUTOR_LEVELS.length - 1; i >= 0; i--) {
        if (score >= CONTRIBUTOR_LEVELS[i].minScore) {
            return CONTRIBUTOR_LEVELS[i].name;
        }
    }
    return CONTRIBUTOR_LEVELS[0].name; // Default to the lowest level
}

async function recordContribution(userId, type, submissionId, city = null) {
    const db = getDb();
    const points = CONTRIBUTION_POINTS[type] || 0;
    const fieldName = CONTRIBUTION_FIELD_MAP[type];

    if (!fieldName) {
        console.warn(`recordContribution: unknown type "${type}" — skipping field increment`);
        return;
    }

    if (points === 0) {
        console.warn(`Attempted to record unknown contribution type: ${type}`);
        return;
    }

    await db.collection('contribution_log').insertOne({
        userId,
        type,
        submissionId,
        scoreValue: points,
        city: city || null,
        regionKey: city ? normalizeRegionKey(city) : null,
        createdAt: new Date(),
    });

    const user = await getUser(userId);
    const baseScore = Number(user.score) || 0;
    const newScore = baseScore + points;
    const newLevel = await assignLevel(newScore);

    // Legacy users may have a missing/partial `contributions` subdoc. Coerce to numbers
    // so missing fields don't NaN-poison the user's score.
    const prevContribs = user.contributions || {};
    const prevField = Number(prevContribs[fieldName]) || 0;
    const prevTotal = Number(prevContribs.total) || 0;

    const updateFields = {
        score: newScore,
        level: newLevel,
        [`contributions.${fieldName}`]: prevField + 1,
        'contributions.total': prevTotal + 1,
        updatedAt: new Date(),
    };

    // 5.1 — set city and derive regionKey on first contribution with a city
    if (city && !user.city) {
        updateFields.city = city;
        updateFields.regionKey = normalizeRegionKey(city);
    }

    // 5.5 — grant ad-free perk when score crosses threshold (never revoke)
    const AD_FREE_THRESHOLD = parseInt(process.env.AD_FREE_SCORE_THRESHOLD || '1500', 10);
    if (!user.adFree && newScore >= AD_FREE_THRESHOLD) {
        updateFields.adFree = true;
    }

    await db.collection('users').updateOne(
        { _id: userId },
        { $set: updateFields },
        { upsert: true }
    );

    console.log(`User ${userId} earned ${points} for ${type}. New score: ${newScore}, Level: ${newLevel}`);
}

// 5.1 — leaderboard filtered by regionKey (or global)
async function getLeaderboard(regionKey = null, limit = 10) {
    const db = getDb();
    const query = regionKey ? { regionKey } : {};
    return db.collection('users')
        .find(query)
        .sort({ score: -1 })
        .limit(limit)
        .project({ _id: 1, email: 1, displayName: 1, score: 1, level: 1, city: 1, regionKey: 1, adFree: 1 })
        .toArray();
}

module.exports = {
    recordContribution,
    getLeaderboard,
    assignLevel,
    getUser,
    normalizeRegionKey,
    CONTRIBUTION_FIELD_MAP,
    CONTRIBUTION_POINTS,
};
