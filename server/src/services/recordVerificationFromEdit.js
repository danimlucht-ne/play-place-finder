const { getConsentSnapshot } = require('../utils/helpers');
const { computeBadges } = require('./badgeService');
const { resolvePlaygroundIdFilter } = require('../utils/playgroundIdFilter');

/**
 * When a user’s playground edit is applied, treat it as a same-day verification (24h cooldown
 * with tap-to-verify / quick-verify). Uses playground centroid as verification coordinates.
 */
async function recordVerificationFromPlaygroundEdit(db, playgroundIdStr, userId, playgroundDoc) {
    if (!playgroundIdStr || !userId || !playgroundDoc) return;

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recent = await db.collection('location_verifications').findOne({
        locationId: playgroundIdStr,
        userId,
        verifiedAt: { $gte: twentyFourHoursAgo },
    });
    if (recent) return;

    const coords = playgroundDoc.location && playgroundDoc.location.coordinates;
    const lat = coords && coords.length === 2 ? coords[1] : 0;
    const lng = coords && coords.length === 2 ? coords[0] : 0;

    let consentSnapshot = {};
    try {
        consentSnapshot = await getConsentSnapshot(userId);
    } catch (_) {
        /* optional */
    }

    await db.collection('location_verifications').insertOne({
        locationId: playgroundIdStr,
        userId,
        verifiedAt: now,
        lat,
        lng,
        distanceMeters: 0,
        source: 'playground_edit',
        ...consentSnapshot,
    });

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const verificationCount30d = await db.collection('location_verifications').countDocuments({
        locationId: playgroundIdStr,
        verifiedAt: { $gte: thirtyDaysAgo },
    });

    const filter = resolvePlaygroundIdFilter(playgroundIdStr);
    await db.collection('playgrounds').updateOne(filter, {
        $set: {
            lastVerifiedAt: now,
            lastVerifiedSource: 'playground_edit',
            verificationCount30d,
        },
        $inc: { verificationCount: 1 },
    });

    const updated = await db.collection('playgrounds').findOne(filter);
    if (updated) {
        const newBadges = computeBadges(updated);
        await db.collection('playgrounds').updateOne(filter, { $set: { badges: newBadges } });
    }
}

module.exports = { recordVerificationFromPlaygroundEdit };
