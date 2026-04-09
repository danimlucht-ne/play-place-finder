'use strict';

const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const { inferDemoCampaign } = require('../utils/inferDemoCreative');

/**
 * Generates an array of YYYY-MM-DD strings for every day in [startDate, endDate].
 */
function buildDateRange(startDate, endDate) {
    const dates = [];
    const cur = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}

function dateBounds(startDate, endDate) {
    return {
        start: new Date(startDate + 'T00:00:00Z'),
        end: new Date(endDate + 'T23:59:59.999Z'),
    };
}

/**
 * Aggregates daily counts for a collection over [startDate, endDate].
 * Returns a map of { 'YYYY-MM-DD': count }.
 */
async function dailyCounts(db, collection, dateField, startDate, endDate, matchExtra = {}) {
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T23:59:59.999Z');
    const pipeline = [
        { $match: { [dateField]: { $gte: start, $lte: end }, ...matchExtra } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: 'UTC' } },
                count: { $sum: 1 },
            },
        },
        { $project: { _id: 0, date: '$_id', count: 1 } },
    ];
    const rows = await db.collection(collection).aggregate(pipeline).toArray();
    const map = {};
    for (const row of rows) map[row.date] = row.count;
    return map;
}

/**
 * getDailyTrends(startDate, endDate)
 * Returns one entry per calendar day in [startDate, endDate], zero-filled.
 * Returns [] when startDate > endDate.
 *
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate   - YYYY-MM-DD
 */
async function getDailyTrends(startDate, endDate) {
    if (startDate > endDate) return [];

    const db = getDb();
    const [playgrounds, photos, crowdReports, issueReports, users, tickets] = await Promise.all([
        dailyCounts(db, 'playgrounds', 'createdAt', startDate, endDate),
        dailyCounts(db, 'contribution_log', 'createdAt', startDate, endDate, { type: 'PHOTO', status: 'APPROVED' }),
        dailyCounts(db, 'contribution_log', 'createdAt', startDate, endDate, { type: 'CROWD_REPORT' }),
        dailyCounts(db, 'contribution_log', 'createdAt', startDate, endDate, { type: 'ISSUE_REPORT' }),
        dailyCounts(db, 'users', 'createdAt', startDate, endDate),
        dailyCounts(db, 'support_tickets', 'createdAt', startDate, endDate),
    ]);

    return buildDateRange(startDate, endDate).map(date => ({
        date,
        newPlaygrounds: playgrounds[date] || 0,
        photosApproved: photos[date] || 0,
        crowdReports: crowdReports[date] || 0,
        issueReports: issueReports[date] || 0,
        newUsers: users[date] || 0,
        supportTickets: tickets[date] || 0,
    }));
}

/**
 * getTopContributorsByPeriod(startDate, endDate, limit)
 * Aggregates contribution_log by userId, sums scoreValue, joins users.
 */
async function getTopContributorsByPeriod(startDate, endDate, limit = 10) {
    const db = getDb();
    const { start, end } = dateBounds(startDate, endDate);

    const pipeline = [
        { $match: { createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: '$userId', score: { $sum: '$scoreValue' } } },
        { $sort: { score: -1 } },
        { $limit: limit },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'user',
            },
        },
        { $unwind: { path: '$user', preserveNullAndEmpty: false } },
        {
            $project: {
                _id: 0,
                userId: '$_id',
                displayName: '$user.displayName',
                score: 1,
                level: '$user.level',
                city: '$user.city',
            },
        },
    ];

    return db.collection('contribution_log').aggregate(pipeline).toArray();
}

async function getContributorLeaderboard(startDate, endDate, options = {}) {
    const db = getDb();
    const { start, end } = dateBounds(startDate, endDate);
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 25, 1), 100);
    const regionKey = options.regionKey || null;

    const pipeline = [
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
            $group: {
                _id: '$userId',
                periodScore: { $sum: '$scoreValue' },
                contributionCount: { $sum: 1 },
                photos: { $sum: { $cond: [{ $eq: ['$type', 'PHOTO'] }, 1, 0] } },
                edits: { $sum: { $cond: [{ $eq: ['$type', 'PLAYGROUND_EDIT'] }, 1, 0] } },
                newPlaygrounds: { $sum: { $cond: [{ $eq: ['$type', 'NEW_PLAYGROUND'] }, 1, 0] } },
                reports: {
                    $sum: {
                        $cond: [
                            { $in: ['$type', ['CROWD_REPORT', 'ISSUE_REPORT']] },
                            1,
                            0,
                        ],
                    },
                },
                lastContributionAt: { $max: '$createdAt' },
            },
        },
        { $sort: { periodScore: -1, contributionCount: -1, lastContributionAt: -1 } },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'user',
            },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
        ...(regionKey ? [{ $match: { 'user.regionKey': regionKey } }] : []),
        { $limit: limit },
        {
            $project: {
                _id: 0,
                userId: '$_id',
                displayName: '$user.displayName',
                email: '$user.email',
                level: '$user.level',
                city: '$user.city',
                regionKey: '$user.regionKey',
                lifetimeScore: '$user.score',
                periodScore: 1,
                contributionCount: 1,
                photos: 1,
                edits: 1,
                newPlaygrounds: 1,
                reports: 1,
                lastContributionAt: 1,
            },
        },
    ];

    const rows = await db.collection('contribution_log').aggregate(pipeline).toArray();
    if (rows.length === 0) return [];

    const moderationRows = await db.collection('moderation_outcomes').aggregate([
        {
            $match: {
                userId: { $in: rows.map((r) => r.userId) },
                createdAt: { $gte: start, $lte: end },
            },
        },
        {
            $group: {
                _id: { userId: '$userId', outcome: '$outcome' },
                count: { $sum: 1 },
            },
        },
    ]).toArray();

    const moderationMap = new Map();
    for (const row of moderationRows) {
        const userId = row._id.userId;
        const entry = moderationMap.get(userId) || { approved: 0, rejected: 0 };
        if (row._id.outcome === 'approved') entry.approved = row.count;
        if (row._id.outcome === 'rejected') entry.rejected = row.count;
        moderationMap.set(userId, entry);
    }

    return rows.map((row, index) => {
        const moderation = moderationMap.get(row.userId) || { approved: 0, rejected: 0 };
        const reviewed = moderation.approved + moderation.rejected;
        return {
            rank: index + 1,
            ...row,
            approved: moderation.approved,
            rejected: moderation.rejected,
            approvalRate: reviewed > 0 ? moderation.approved / reviewed : null,
        };
    });
}

async function getContributionOverview(startDate, endDate, options = {}) {
    const db = getDb();
    const { start, end } = dateBounds(startDate, endDate);
    const regionKey = options.regionKey || null;

    const contributionPipeline = [
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
            $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'user',
            },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
        ...(regionKey ? [{ $match: { 'user.regionKey': regionKey } }] : []),
        {
            $group: {
                _id: null,
                pointsAwarded: { $sum: '$scoreValue' },
                contributionCount: { $sum: 1 },
                activeContributorsSet: { $addToSet: '$userId' },
                photos: { $sum: { $cond: [{ $eq: ['$type', 'PHOTO'] }, 1, 0] } },
                edits: { $sum: { $cond: [{ $eq: ['$type', 'PLAYGROUND_EDIT'] }, 1, 0] } },
                newPlaygrounds: { $sum: { $cond: [{ $eq: ['$type', 'NEW_PLAYGROUND'] }, 1, 0] } },
                reports: {
                    $sum: {
                        $cond: [
                            { $in: ['$type', ['CROWD_REPORT', 'ISSUE_REPORT']] },
                            1,
                            0,
                        ],
                    },
                },
            },
        },
        {
            $project: {
                _id: 0,
                pointsAwarded: 1,
                contributionCount: 1,
                photos: 1,
                edits: 1,
                newPlaygrounds: 1,
                reports: 1,
                activeContributors: { $size: '$activeContributorsSet' },
            },
        },
    ];

    const moderationPipeline = [
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
            $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'user',
            },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
        ...(regionKey ? [{ $match: { 'user.regionKey': regionKey } }] : []),
        {
            $group: {
                _id: null,
                approved: { $sum: { $cond: [{ $eq: ['$outcome', 'approved'] }, 1, 0] } },
                rejected: { $sum: { $cond: [{ $eq: ['$outcome', 'rejected'] }, 1, 0] } },
            },
        },
        { $project: { _id: 0, approved: 1, rejected: 1 } },
    ];

    const [contributionRows, moderationRows] = await Promise.all([
        db.collection('contribution_log').aggregate(contributionPipeline).toArray(),
        db.collection('moderation_outcomes').aggregate(moderationPipeline).toArray(),
    ]);

    const contributions = contributionRows[0] || {
        pointsAwarded: 0,
        contributionCount: 0,
        activeContributors: 0,
        photos: 0,
        edits: 0,
        newPlaygrounds: 0,
        reports: 0,
    };
    const moderation = moderationRows[0] || { approved: 0, rejected: 0 };
    const reviewed = moderation.approved + moderation.rejected;

    return {
        ...contributions,
        approved: moderation.approved,
        rejected: moderation.rejected,
        approvalRate: reviewed > 0 ? moderation.approved / reviewed : null,
    };
}

async function getAdPerformanceOverview(startDate, endDate) {
    const db = getDb();
    const { start, end } = dateBounds(startDate, endDate);

    const totals = await db.collection('adEvents').aggregate([
        { $match: { timestamp: { $gte: start, $lte: end } } },
        {
            $group: {
                _id: '$type',
                count: { $sum: 1 },
                visitors: { $addToSet: '$visitorKey' },
            },
        },
    ]).toArray();

    const impressions = totals.find((r) => r._id === 'impression')?.count || 0;
    const clicks = totals.find((r) => r._id === 'click')?.count || 0;
    const uniqueReach = (totals.find((r) => r._id === 'impression')?.visitors || []).filter(Boolean).length;

    const [activeCampaigns, placements, topCampaigns, topCities] = await Promise.all([
        db.collection('adCampaigns').countDocuments({
            startDate: { $lte: end },
            endDate: { $gte: start },
            status: { $in: ['active', 'completed'] },
        }),
        db.collection('adEvents').aggregate([
            { $match: { timestamp: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: { placement: '$placement', type: '$type' },
                    count: { $sum: 1 },
                },
            },
        ]).toArray(),
        db.collection('adEvents').aggregate([
            { $match: { timestamp: { $gte: start, $lte: end }, campaignId: { $ne: null } } },
            {
                $group: {
                    _id: { campaignId: '$campaignId', type: '$type' },
                    count: { $sum: 1 },
                },
            },
        ]).toArray(),
        db.collection('adEvents').aggregate([
            { $match: { timestamp: { $gte: start, $lte: end }, cityId: { $nin: [null, ''] } } },
            {
                $group: {
                    _id: { cityId: '$cityId', type: '$type' },
                    count: { $sum: 1 },
                },
            },
        ]).toArray(),
    ]);

    const placementMap = new Map();
    for (const row of placements) {
        const key = row._id.placement || 'unknown';
        const entry = placementMap.get(key) || { placement: key, impressions: 0, clicks: 0 };
        if (row._id.type === 'impression') entry.impressions = row.count;
        if (row._id.type === 'click') entry.clicks = row.count;
        placementMap.set(key, entry);
    }

    const topCampaignMap = new Map();
    for (const row of topCampaigns) {
        const key = String(row._id.campaignId);
        const entry = topCampaignMap.get(key) || { campaignId: key, impressions: 0, clicks: 0 };
        if (row._id.type === 'impression') entry.impressions = row.count;
        if (row._id.type === 'click') entry.clicks = row.count;
        topCampaignMap.set(key, entry);
    }

    const topCityMap = new Map();
    for (const row of topCities) {
        const key = row._id.cityId;
        const entry = topCityMap.get(key) || { cityId: key, impressions: 0, clicks: 0 };
        if (row._id.type === 'impression') entry.impressions = row.count;
        if (row._id.type === 'click') entry.clicks = row.count;
        topCityMap.set(key, entry);
    }

    const placementCampaignRows = await db.collection('adEvents').aggregate([
        { $match: { timestamp: { $gte: start, $lte: end }, campaignId: { $ne: null } } },
        {
            $group: {
                _id: { placement: '$placement', campaignId: '$campaignId' },
                impressions: { $sum: { $cond: [{ $eq: ['$type', 'impression'] }, 1, 0] } },
                clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
            },
        },
    ]).toArray();

    const allCampaignIdStrings = new Set([
        ...topCampaignMap.keys(),
        ...placementCampaignRows
            .map((r) => String(r._id.campaignId))
            .filter((id) => ObjectId.isValid(id)),
    ]);
    const allObjectIds = [...allCampaignIdStrings]
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

    const allCampaigns = allObjectIds.length > 0
        ? await db.collection('adCampaigns').find({ _id: { $in: allObjectIds } })
            .project({ _id: 1, status: 1, advertiserName: 1, businessName: 1, headline: 1, creativeId: 1 })
            .toArray()
        : [];

    const creativeIds = [...new Set(allCampaigns.map((c) => c.creativeId).filter(Boolean))];
    const creativeDocs = creativeIds.length > 0
        ? await db.collection('adCreatives').find({ _id: { $in: creativeIds } }).toArray()
        : [];
    const creativeById = new Map(creativeDocs.map((cr) => [String(cr._id), cr]));

    const demoCampaignIds = new Set();
    const campaignMeta = new Map();
    for (const c of allCampaigns) {
        const idStr = String(c._id);
        const cr = creativeById.get(String(c.creativeId));
        const isDemo = inferDemoCampaign(cr);
        if (isDemo) demoCampaignIds.add(idStr);
        campaignMeta.set(idStr, { ...c, isDemoCampaign: isDemo });
    }

    return {
        activeCampaigns,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : 0,
        uniqueReach,
        frequency: uniqueReach > 0 ? impressions / uniqueReach : 0,
        placements: Array.from(placementMap.values())
            .map((entry) => {
                const placementKey = String(entry.placement || 'unknown');
                const includesDemoOrTestTraffic = placementCampaignRows.some(
                    (row) => String(row._id.placement || 'unknown') === placementKey
                        && (row.impressions || 0) > 0
                        && demoCampaignIds.has(String(row._id.campaignId)),
                );
                return {
                    ...entry,
                    ctr: entry.impressions > 0 ? entry.clicks / entry.impressions : 0,
                    includesDemoOrTestTraffic,
                };
            })
            .sort((a, b) => b.impressions - a.impressions),
        topCampaigns: Array.from(topCampaignMap.values())
            .map((entry) => {
                const meta = campaignMeta.get(entry.campaignId) || {};
                return {
                    ...entry,
                    status: meta.status || '',
                    label: meta.businessName || meta.advertiserName || meta.headline || entry.campaignId,
                    ctr: entry.impressions > 0 ? entry.clicks / entry.impressions : 0,
                    isDemoCampaign: !!meta.isDemoCampaign,
                };
            })
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 5),
        topCities: Array.from(topCityMap.values())
            .map((entry) => ({
                ...entry,
                ctr: entry.impressions > 0 ? entry.clicks / entry.impressions : 0,
            }))
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 5),
    };
}

async function getAnalyticsOverview(startDate, endDate, options = {}) {
    const [contributions, ads] = await Promise.all([
        getContributionOverview(startDate, endDate, options),
        getAdPerformanceOverview(startDate, endDate),
    ]);
    return {
        startDate,
        endDate,
        regionKey: options.regionKey || null,
        contributions,
        ads,
    };
}

/**
 * getCityGrowthSummary()
 * Groups active playgrounds by regionKey, counts total and verified,
 * joins seeded_regions for seedStatus.
 */
async function getCityGrowthSummary() {
    const db = getDb();
    const pipeline = [
        { $match: { archivedAt: { $exists: false } } },
        {
            $group: {
                _id: '$regionKey',
                totalPlaygrounds: { $sum: 1 },
                verifiedPlaygrounds: {
                    $sum: { $cond: [{ $gte: ['$verificationCount', 1] }, 1, 0] },
                },
            },
        },
        {
            $lookup: {
                from: 'seeded_regions',
                localField: '_id',
                foreignField: 'regionKey',
                as: 'region',
            },
        },
        { $unwind: { path: '$region', preserveNullAndEmpty: true } },
        {
            $project: {
                _id: 0,
                regionKey: '$_id',
                city: '$region.city',
                state: '$region.state',
                totalPlaygrounds: 1,
                verifiedPlaygrounds: 1,
                seedStatus: '$region.seedStatus',
            },
        },
        { $sort: { totalPlaygrounds: -1 } },
    ];

    return db.collection('playgrounds').aggregate(pipeline).toArray();
}

module.exports = {
    getDailyTrends,
    getTopContributorsByPeriod,
    getContributorLeaderboard,
    getContributionOverview,
    getAdPerformanceOverview,
    getAnalyticsOverview,
    getCityGrowthSummary,
};
