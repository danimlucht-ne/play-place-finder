const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { ObjectId } = require('mongodb');
const { verifyAdminToken } = require('../services/authService');
const adminModerationService = require('../services/adminModerationService');
const {
    getDailyTrends,
    getTopContributorsByPeriod,
    getContributorLeaderboard,
    getAnalyticsOverview,
    getCityGrowthSummary,
} = require('../services/adminDailyTrendsService');
const contributionService = require('../services/contributionService');
const { applyApprovedSuggestion, buildTargetPlaygroundSummary, parseFeatureSuggestionMessage } = require('../services/suggestionApprovalService');
const seedOrchestratorService = require('../services/seedOrchestratorService');
const { enqueueLightRefreshIfNeeded } = require('../services/seedJobQueueService');
const { runLightRefresh } = require('../services/seedLightRefreshService');
const { validate } = require('../services/equipmentValidationService');
const venueMergeService = require('../services/venueMergeService');
const { recategorizePlaygroundTypes } = require('../services/recategorizePlaygroundTypesService');
const moderationStatsService = require('../services/moderationStatsService');
const { recordVerificationFromPlaygroundEdit } = require('../services/recordVerificationFromEdit');
const seedTileService = require('../services/seedTileService');
const { appendRunLog } = require('../services/seedRunLogService');
const {
    listPlaygroundAudits,
    recordPlaygroundAudit,
    rollbackAuditChange,
    rollbackChangesByUser,
} = require('../services/changeAuditService');
const { resolvePlaygroundIdFilter } = require('../utils/playgroundIdFilter');

// ─── Helper: send user notification ──────────────────────────────────────────
async function notifyUser(db, userId, message) {
    await db.collection('user_notifications').insertOne({
        userId,
        message,
        read: false,
        createdAt: new Date(),
    });
}

/** Keep 2dsphere index in sync when approving edits that only send latitude/longitude. */
function mergeLatLngIntoLocationForSet(setDoc) {
    if (!setDoc || typeof setDoc !== 'object') return {};
    const out = { ...setDoc };
    const lat = out.latitude;
    const lng = out.longitude;
    if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
        out.location = { type: 'Point', coordinates: [lng, lat] };
    }
    return out;
}

/** Batch-load email + displayName for admin triage (support tickets, etc.). */
async function loadUserBasicsByIds(db, userIds) {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (ids.length === 0) return new Map();
    const users = await db.collection('users')
        .find({ _id: { $in: ids } })
        .project({ email: 1, displayName: 1 })
        .toArray();
    const map = new Map();
    for (const u of users) {
        if (u._id != null) map.set(String(u._id), u);
    }
    return map;
}

function actorProfileFromUserMap(userById, actorUserId) {
    if (!actorUserId) return null;
    const uid = String(actorUserId);
    const u = userById.get(uid);
    return {
        userId: uid,
        email: u?.email ?? null,
        displayName: u?.displayName ?? null,
    };
}

const SupportTicketStatus = {
    NEEDS_ADMIN_REVIEW: 'NEEDS_ADMIN_REVIEW',
    RESOLVED: 'RESOLVED',
    REJECTED: 'REJECTED'
};

const SupportTicketType = {
    QUESTION: 'question',
    COMPLAINT: 'complaint',
    REQUEST_UPDATE: 'request_update',
    REPORT_ISSUE: 'report_issue',
    SUGGESTION: 'suggestion',
    OTHER: 'other'
};

/** Fills missing suggestion fields from [message] for admin API (legacy rows + client quirks). */
function enrichSuggestionTicketForResponse(t) {
    if (!t || t.ticketType !== SupportTicketType.SUGGESTION) return t;
    if (t.suggestionCategory && t.suggestionLabel) return t;
    const parsed = parseFeatureSuggestionMessage(t.message);
    return {
        ...t,
        suggestionCategory: t.suggestionCategory || parsed.category,
        suggestionLabel: t.suggestionLabel || parsed.label,
    };
}

async function ensureTargetPlaygroundSummary(db, t) {
    const cur = t.targetPlaygroundSummary;
    if (cur && cur.name && String(cur.name).trim()) return t;
    if (String(t.targetKind || '').toLowerCase() === 'playground' && t.targetId) {
        try {
            const s = await buildTargetPlaygroundSummary(db, t.targetKind, t.targetId);
            if (s) return { ...t, targetPlaygroundSummary: s };
        } catch (_) { /* ignore */ }
    }
    return t;
}

// Apply admin auth to all routes in this router
router.use(verifyAdminToken);

// GET moderation queue
router.get('/moderation', async (req, res) => {
    const { status } = req.query;
    try {
        const queue = await adminModerationService.getQueue(status);
        res.json({ message: "success", data: queue });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET single moderation item
router.get('/moderation/:id', async (req, res) => {
    try {
        const item = await adminModerationService.getQueueItem(req.params.id);
        if (!item) return res.status(404).json({ message: "Moderation item not found" });
        res.json({ message: "success", data: item });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST approve moderation item
router.post('/moderation/:id/approve', async (req, res) => {
    try {
        await adminModerationService.approve(req.params.id, req.user.uid);
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST reject moderation item
router.post('/moderation/:id/reject', async (req, res) => {
    const { decisionReason } = req.body;
    try {
        await adminModerationService.reject(req.params.id, req.user.uid, decisionReason);
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST retry moderation item
router.post('/moderation/:id/retry', async (req, res) => {
    try {
        await adminModerationService.retry(req.params.id, req.user.uid);
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET support tickets list
// ?queue=support (default) — excludes feature-label suggestions
// ?queue=suggestions — only suggestion tickets (equipment / amenity / ground / etc.)
router.get('/support-tickets', async (req, res) => {
    const db = getDb();
    const status = req.query.status || SupportTicketStatus.NEEDS_ADMIN_REVIEW;
    const allowedStatuses = new Set(Object.values(SupportTicketStatus));
    const normalizedStatus = allowedStatuses.has(status) ? status : SupportTicketStatus.NEEDS_ADMIN_REVIEW;
    const queue = String(req.query.queue || 'support').toLowerCase();
    const typeClause = queue === 'suggestions'
        ? { ticketType: SupportTicketType.SUGGESTION }
        : queue === 'all'
            ? {}
            : { ticketType: { $ne: SupportTicketType.SUGGESTION } };

    try {
        const tickets = await db.collection("support_tickets")
            .find({ status: normalizedStatus, ...typeClause })
            .sort({ createdAt: -1 })
            .limit(200)
            .toArray();

        const userById = await loadUserBasicsByIds(db, tickets.map((t) => t.actorUserId));

        const enriched = [];
        for (const t of tickets) {
            const withSum = await ensureTargetPlaygroundSummary(db, t);
            enriched.push(enrichSuggestionTicketForResponse(withSum));
        }

        const transformed = enriched.map((t) => ({
            id: t._id.toHexString(),
            actorUserId: t.actorUserId ?? null,
            actorProfile: actorProfileFromUserMap(userById, t.actorUserId),
            ticketType: t.ticketType,
            category: t.category,
            message: t.message,
            status: t.status,
            createdAt: t.createdAt,
            targetKind: t.targetKind,
            targetId: t.targetId,
            suggestionCategory: t.suggestionCategory ?? null,
            suggestionLabel: t.suggestionLabel ?? null,
            targetPlaygroundSummary: t.targetPlaygroundSummary ?? null,
        }));

        res.json({ message: "success", data: transformed });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET single support ticket
router.get('/support-tickets/:id', async (req, res) => {
    const db = getDb();
    try {
        const ticket = await db.collection("support_tickets").findOne({ _id: new ObjectId(req.params.id) });
        if (!ticket) return res.status(404).json({ message: "Support ticket not found" });
        const withSum = await ensureTargetPlaygroundSummary(db, ticket);
        const merged = enrichSuggestionTicketForResponse(withSum);
        const userById = await loadUserBasicsByIds(db, [merged.actorUserId]);
        const actorProfile = actorProfileFromUserMap(userById, merged.actorUserId);
        res.json({
            message: "success",
            data: { ...merged, id: merged._id.toHexString(), actorProfile },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST approve a feature suggestion — applies label to playground + catalog, awards points, notifies user
router.post('/support-tickets/:id/approve-suggestion', async (req, res) => {
    const db = getDb();
    const { finalLabel } = req.body || {};
    const ticketIdHex = req.params.id;
    const adminUid = req.user && req.user.uid ? req.user.uid : null;
    let stage = 'load_ticket';
    try {
        const ticket = await db.collection('support_tickets').findOne({ _id: new ObjectId(ticketIdHex) });
        if (!ticket) return res.status(404).json({ message: 'Support ticket not found' });
        if (ticket.ticketType !== SupportTicketType.SUGGESTION) {
            return res.status(400).json({ error: 'This ticket is not a feature suggestion.' });
        }
        if (ticket.status !== SupportTicketStatus.NEEDS_ADMIN_REVIEW) {
            return res.status(400).json({ error: 'Ticket is not pending review.' });
        }
        const parsed = parseFeatureSuggestionMessage(ticket.message);
        const cat = ticket.suggestionCategory || parsed.category;
        const raw = (finalLabel != null && String(finalLabel).trim())
            || ticket.suggestionLabel
            || (parsed.label || '');
        if (!cat || !String(raw).trim()) {
            return res.status(400).json({ error: 'Missing suggestion category or label on this ticket.' });
        }
        const targetPlaygroundId = ticket.targetId
            || (ticket.targetPlaygroundSummary && ticket.targetPlaygroundSummary.id)
            || null;
        if (!targetPlaygroundId) {
            return res.status(400).json({ error: 'Suggestion has no target playground.' });
        }

        stage = 'load_before';
        const targetFilter = resolvePlaygroundIdFilter(targetPlaygroundId);
        const beforePg = await db.collection('playgrounds').findOne(targetFilter);

        stage = 'apply';
        const { appliedLabel, cityForPoints } = await applyApprovedSuggestion(db, targetPlaygroundId, cat, raw);

        stage = 'load_after';
        const afterPg = await db.collection('playgrounds').findOne(targetFilter);

        // Side-effects below are best-effort: a failure here must NOT roll back the
        // approval that already wrote to the playground + catalog. Any error gets logged
        // with the stage so we can still see what's broken without 500-ing the admin.
        if (beforePg && afterPg) {
            try {
                stage = 'audit';
                await recordPlaygroundAudit(db, {
                    playgroundId: String(afterPg._id),
                    operationType: 'update',
                    actorUserId: adminUid,
                    sourceType: 'support_suggestion_approval',
                    sourceId: ticket._id.toHexString(),
                    reason: `Approved suggestion: ${appliedLabel}`,
                    beforeSnapshot: beforePg,
                    afterSnapshot: afterPg,
                    metadata: { suggestionCategory: cat },
                });
            } catch (auditErr) {
                console.error('[approve-suggestion] audit failed (non-fatal):',
                    { ticketId: ticketIdHex, message: auditErr.message });
            }
        }

        stage = 'resolve_ticket';
        await db.collection('support_tickets').updateOne(
            { _id: ticket._id },
            {
                $set: {
                    status: SupportTicketStatus.RESOLVED,
                    resolutionReason: `Approved and applied: ${appliedLabel}`,
                    resolvedAt: new Date(),
                    resolvedBy: adminUid,
                    appliedSuggestionLabel: appliedLabel,
                    updatedAt: new Date(),
                },
            }
        );

        const pts = contributionService.CONTRIBUTION_POINTS.SUGGESTION_APPROVED || 100;
        let pgName = 'the place';
        try {
            stage = 'summary';
            const mergedTicket = await ensureTargetPlaygroundSummary(db, ticket);
            if (mergedTicket.targetPlaygroundSummary && mergedTicket.targetPlaygroundSummary.name) {
                pgName = mergedTicket.targetPlaygroundSummary.name;
            }
        } catch (sumErr) {
            console.error('[approve-suggestion] summary failed (non-fatal):',
                { ticketId: ticketIdHex, message: sumErr.message });
        }

        if (ticket.actorUserId) {
            try {
                stage = 'contribution';
                await contributionService.recordContribution(
                    ticket.actorUserId,
                    'SUGGESTION_APPROVED',
                    ticket._id.toHexString(),
                    cityForPoints
                );
            } catch (contribErr) {
                console.error('[approve-suggestion] contribution failed (non-fatal):',
                    { ticketId: ticketIdHex, message: contribErr.message });
            }
            try {
                stage = 'notify';
                await notifyUser(
                    db,
                    ticket.actorUserId,
                    `Your suggestion "${appliedLabel}" for "${pgName}" was approved. It is now on the listing and you earned ${pts} points. Thank you!`
                );
            } catch (notifyErr) {
                console.error('[approve-suggestion] notify failed (non-fatal):',
                    { ticketId: ticketIdHex, message: notifyErr.message });
            }
        }

        res.json({ message: 'success', data: { appliedLabel } });
    } catch (err) {
        const code = err.statusCode || 500;
        console.error('[approve-suggestion] failed at stage:', stage, {
            ticketId: ticketIdHex,
            message: err.message,
            stack: err.stack,
        });
        res.status(code).json({ error: err.message, stage });
    }
});

// POST resolve support ticket
router.post('/support-tickets/:id/resolve', async (req, res) => {
    const db = getDb();
    const { resolutionReason } = req.body || {};
    try {
        await db.collection("support_tickets").updateOne(
            { _id: new ObjectId(req.params.id) },
            {
                $set: {
                    status: SupportTicketStatus.RESOLVED,
                    resolutionReason: resolutionReason || null,
                    resolvedAt: new Date(),
                    resolvedBy: req.user.uid,
                    updatedAt: new Date()
                }
            }
        );
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST reject support ticket
router.post('/support-tickets/:id/reject', async (req, res) => {
    const db = getDb();
    const { resolutionReason } = req.body || {};
    try {
        const tid = new ObjectId(req.params.id);
        const ticket = await db.collection('support_tickets').findOne({ _id: tid });
        if (!ticket) return res.status(404).json({ message: 'Support ticket not found' });

        await db.collection("support_tickets").updateOne(
            { _id: tid },
            {
                $set: {
                    status: SupportTicketStatus.REJECTED,
                    resolutionReason: resolutionReason || null,
                    rejectedAt: new Date(),
                    rejectedBy: req.user.uid,
                    updatedAt: new Date()
                }
            }
        );

        const reasonText = resolutionReason && String(resolutionReason).trim()
            ? String(resolutionReason).trim()
            : 'No reason was provided.';
        if (ticket.actorUserId) {
            const merged = await ensureTargetPlaygroundSummary(db, ticket);
            const pgName = (merged.targetPlaygroundSummary && merged.targetPlaygroundSummary.name)
                ? merged.targetPlaygroundSummary.name
                : (ticket.targetId ? `place ${ticket.targetId}` : 'your request');
            const label = ticket.suggestionLabel || ticket.message || 'your suggestion';
            if (ticket.ticketType === SupportTicketType.SUGGESTION) {
                await notifyUser(
                    db,
                    ticket.actorUserId,
                    `About your suggestion "${String(label).slice(0, 200)}" for "${pgName}": it was not added. Admin note: ${reasonText}`
                );
            } else {
                await notifyUser(
                    db,
                    ticket.actorUserId,
                    `Update on your support request regarding "${pgName}": ${reasonText}`
                );
            }
        }

        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Trends & Analytics ───────────────────────────────────────────────────────

// GET /admin/trends/daily?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get('/trends/daily', async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }
    try {
        const data = await getDailyTrends(startDate, endDate);
        res.json({ message: 'success', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/seed-jobs', async (req, res) => {
    const db = getDb();
    const { regionKey } = req.query;
    const filter = {};
    if (regionKey) filter.regionKey = regionKey;
    try {
        const jobs = await db.collection('seed_jobs')
            .find(filter)
            .sort({ createdAt: -1 })
            .limit(100)
            .toArray();
        res.json({ message: 'success', data: jobs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/regions/:regionKey/light-refresh', async (req, res) => {
    const db = getDb();
    const { regionKey } = req.params;
    const force = req.body?.force === true || req.query.force === 'true';
    try {
        const region = await db.collection('seeded_regions').findOne({ regionKey });
        if (!region) return res.status(404).json({ error: `Region "${regionKey}" not found` });
        const queued = await enqueueLightRefreshIfNeeded(db, region, {
            force,
            requestedBy: 'admin',
            requestedByUserId: req.user?.uid || null,
        });
        if (queued.enqueued) {
            setImmediate(() => {
                runLightRefresh(regionKey).catch((err) =>
                    console.error(`[light-refresh] ${regionKey}:`, err.message),
                );
            });
        }
        return res.status(queued.enqueued ? 202 : 200).json({
            message: queued.enqueued ? 'Light refresh queued' : 'Light refresh not queued',
            data: { regionKey, ...queued },
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /admin/trends/top-contributors?startDate=&endDate=&limit=10
router.get('/trends/top-contributors', async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    try {
        const data = await getTopContributorsByPeriod(startDate, endDate, limit);
        res.json({ message: 'success', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /admin/trends/contributor-leaderboard?startDate=&endDate=&limit=25&regionKey=
router.get('/trends/contributor-leaderboard', async (req, res) => {
    const { startDate, endDate, regionKey } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    try {
        const data = await getContributorLeaderboard(startDate, endDate, { limit, regionKey: regionKey || null });
        res.json({ message: 'success', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /admin/trends/overview?startDate=&endDate=&regionKey=
router.get('/trends/overview', async (req, res) => {
    const { startDate, endDate, regionKey } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
    }
    try {
        const data = await getAnalyticsOverview(startDate, endDate, { regionKey: regionKey || null });
        res.json({ message: 'success', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /admin/trends/city-growth
router.get('/trends/city-growth', async (req, res) => {
    try {
        const data = await getCityGrowthSummary();
        res.json({ message: 'success', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Category Option Suggestions ─────────────────────────────────────────────

// GET /admin/category-options/pending — list pending category suggestions
router.get('/category-options/pending', async (req, res) => {
    const db = getDb();
    try {
        const tickets = await db.collection("support_tickets")
            .find({ ticketType: SupportTicketType.SUGGESTION, status: SupportTicketStatus.NEEDS_ADMIN_REVIEW })
            .sort({ createdAt: -1 })
            .limit(200)
            .toArray();
        res.json({ message: "success", data: tickets.map(t => ({ ...t, id: t._id.toHexString() })) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/category-options/:id/approve — approve a category suggestion
router.post('/category-options/:id/approve', async (req, res) => {
    const db = getDb();
    const { category, value } = req.body || {};
    try {
        await db.collection("support_tickets").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: req.user.uid } }
        );
        // If category + value provided, persist to the category_options collection
        if (category && value) {
            await db.collection("category_options").updateOne(
                { category },
                { $addToSet: { values: value } },
                { upsert: true }
            );
        }
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/category-options/:id/reject — reject a category suggestion
router.post('/category-options/:id/reject', async (req, res) => {
    const db = getDb();
    const { reason } = req.body || {};
    try {
        await db.collection("support_tickets").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'REJECTED', resolutionReason: reason || null, rejectedAt: new Date(), rejectedBy: req.user.uid } }
        );
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Monthly Awards (5.8) ─────────────────────────────────────────────────────
// POST /admin/awards/run-monthly
router.post('/awards/run-monthly', async (req, res) => {
    const db = getDb();
    const now = new Date();
    // Previous calendar month
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-based
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    try {
        // Aggregate top contributor per regionKey for the month
        const topByRegion = await db.collection('contribution_log').aggregate([
            { $match: { createdAt: { $gte: startDate, $lt: endDate } } },
            { $group: { _id: '$userId', totalScore: { $sum: '$scoreValue' } } },
            { $sort: { totalScore: -1 } },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'userDoc'
                }
            },
            { $unwind: { path: '$userDoc', preserveNullAndEmpty: false } },
            {
                $group: {
                    _id: '$userDoc.regionKey',
                    userId: { $first: '$_id' },
                    score: { $first: '$totalScore' },
                    level: { $first: '$userDoc.level' },
                }
            },
            { $match: { _id: { $ne: null } } }
        ]).toArray();

        if (topByRegion.length === 0) {
            return res.json({ message: 'No contributions found for the previous month.', inserted: 0 });
        }

        const awards = topByRegion.map(r => ({
            regionKey: r._id,
            userId: r.userId,
            month: monthStr,
            score: r.score,
            level: r.level,
            awardedAt: new Date(),
        }));

        try {
            const result = await db.collection('monthly_awards').insertMany(awards, { ordered: false });
            res.json({ message: 'success', inserted: result.insertedCount });
        } catch (bulkErr) {
            if (bulkErr.code === 11000) {
                return res.status(409).json({ error: `Awards for ${monthStr} already exist.` });
            }
            throw bulkErr;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/moderation/:id/approve-photo
router.post("/moderation/:id/approve-photo", verifyAdminToken, async (req, res) => {
    const db = getDb();
    try {
        const item = await db.collection("moderation_queue").findOne({ _id: new ObjectId(req.params.id) });
        if (!item) return res.status(404).json({ error: "Item not found" });

        // Apply photo to playground
        await db.collection("playgrounds").updateOne(
            { _id: new ObjectId(item.playgroundId) },
            { $addToSet: { imageUrls: item.previewUrl } }
        );
        await db.collection("moderation_queue").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'APPROVED', reviewedAt: new Date(), reviewedBy: req.user.uid } }
        );

        // Award points + notify user
        const photoRecord = await db.collection("photo_uploads").findOne({ _id: new ObjectId(item.submissionId) });
        if (photoRecord?.uploadedBy) {
            const playground = await db.collection("playgrounds").findOne({ _id: new ObjectId(item.playgroundId) });
            await contributionService.recordContribution(photoRecord.uploadedBy, 'PHOTO', item.submissionId, playground?.city);
            await notifyUser(db, photoRecord.uploadedBy, `Your photo for "${item.playgroundName}" was approved! You earned points.`);
        }

        moderationStatsService.recordOutcomeFromQueueItem(item, 'approved').catch(() => {});

        res.json({ message: "Photo approved" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/moderation/:id/reject-photo
router.post("/moderation/:id/reject-photo", verifyAdminToken, async (req, res) => {
    const db = getDb();
    const { reason } = req.body || {};
    try {
        const item = await db.collection("moderation_queue").findOne({ _id: new ObjectId(req.params.id) });
        if (!item) return res.status(404).json({ error: "Item not found" });

        await db.collection("moderation_queue").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'REJECTED', reason: reason || null, reviewedAt: new Date(), reviewedBy: req.user.uid } }
        );

        // Notify user with reason
        const photoRecord = await db.collection("photo_uploads").findOne({ _id: new ObjectId(item.submissionId) });
        if (photoRecord?.uploadedBy) {
            const msg = reason
                ? `Your photo for "${item.playgroundName}" was not approved. Reason: ${reason}`
                : `Your photo for "${item.playgroundName}" was not approved.`;
            await notifyUser(db, photoRecord.uploadedBy, msg);
        }

        moderationStatsService.recordOutcomeFromQueueItem(item, 'rejected').catch(() => {});

        res.json({ message: "Photo rejected" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/moderation/:id/approve-new-playground — insert pending NEW_PLAYGROUND from queue
router.post("/moderation/:id/approve-new-playground", verifyAdminToken, async (req, res) => {
    const db = getDb();
    try {
        const item = await db.collection("moderation_queue").findOne({ _id: new ObjectId(req.params.id) });
        if (!item) return res.status(404).json({ error: "Item not found" });
        if (item.submissionType !== 'NEW_PLAYGROUND') {
            return res.status(400).json({ error: "Not a pending new playground submission" });
        }
        const doc = item.proposedNewPlayground;
        if (!doc) return res.status(400).json({ error: "Missing proposed playground payload" });

        const insertDoc = {
            ...doc,
            lastUpdated: new Date(),
            geminiSubmissionReview: {
                ...(doc.geminiSubmissionReview || {}),
                adminApproved: true,
                approvedAt: new Date().toISOString(),
            },
        };
        const result = await db.collection("playgrounds").insertOne(insertDoc);
        const inserted = await db.collection('playgrounds').findOne({ _id: result.insertedId });
        if (inserted) {
            await recordPlaygroundAudit(db, {
                playgroundId: result.insertedId.toHexString(),
                operationType: 'create',
                actorUserId: req.user.uid,
                sourceType: 'moderation_new_playground_approval',
                sourceId: item._id.toHexString(),
                reason: 'Admin approved pending new playground',
                beforeSnapshot: null,
                afterSnapshot: inserted,
            });
        }

        await db.collection("moderation_queue").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'APPROVED', reviewedAt: new Date(), reviewedBy: req.user.uid } }
        );

        if (item.submittedByUserId) {
            const playground = await db.collection("playgrounds").findOne({ _id: result.insertedId });
            await contributionService.recordContribution(
                item.submittedByUserId,
                'NEW_PLAYGROUND',
                result.insertedId.toHexString(),
                playground?.city,
            );
            await notifyUser(
                db,
                item.submittedByUserId,
                `Your new place "${doc.name || 'listing'}" was approved and is now live.`,
            );
        }

        moderationStatsService.recordOutcomeFromQueueItem(item, 'approved').catch(() => {});

        res.json({ message: "New playground created", id: result.insertedId.toHexString() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/moderation/:id/reject-new-playground
router.post("/moderation/:id/reject-new-playground", verifyAdminToken, async (req, res) => {
    const db = getDb();
    const { reason } = req.body || {};
    try {
        const item = await db.collection("moderation_queue").findOne({ _id: new ObjectId(req.params.id) });
        if (!item) return res.status(404).json({ error: "Item not found" });
        if (item.submissionType !== 'NEW_PLAYGROUND') {
            return res.status(400).json({ error: "Not a pending new playground submission" });
        }

        await db.collection("moderation_queue").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'REJECTED', decisionReason: reason || null, reviewedAt: new Date(), reviewedBy: req.user.uid } }
        );

        if (item.submittedByUserId) {
            const msg = reason
                ? `Your new place submission was not approved. Reason: ${reason}`
                : `Your new place submission was not approved.`;
            await notifyUser(db, item.submittedByUserId, msg);
        }

        moderationStatsService.recordOutcomeFromQueueItem(item, 'rejected').catch(() => {});

        res.json({ message: "Rejected" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/moderation/:id/approve-edit
router.post("/moderation/:id/approve-edit", verifyAdminToken, async (req, res) => {
    const db = getDb();
    try {
        const item = await db.collection("moderation_queue").findOne({ _id: new ObjectId(req.params.id) });
        if (!item) return res.status(404).json({ error: "Item not found" });

        const beforePlayground = await db.collection('playgrounds').findOne({ _id: new ObjectId(item.playgroundId) });
        const setPayload = mergeLatLngIntoLocationForSet(item.proposedChanges || {});
        setPayload.lastUpdated = new Date();
        await db.collection("playgrounds").updateOne(
            { _id: new ObjectId(item.playgroundId) },
            { $set: setPayload }
        );
        const afterPlayground = await db.collection('playgrounds').findOne({ _id: new ObjectId(item.playgroundId) });
        if (beforePlayground && afterPlayground) {
            await recordPlaygroundAudit(db, {
                playgroundId: String(afterPlayground._id),
                operationType: 'update',
                actorUserId: req.user.uid,
                sourceType: 'moderation_edit_approval',
                sourceId: item._id.toHexString(),
                reason: 'Admin approved pending playground edit',
                beforeSnapshot: beforePlayground,
                afterSnapshot: afterPlayground,
            });
        }
        await db.collection("moderation_queue").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'APPROVED', reviewedAt: new Date(), reviewedBy: req.user.uid } }
        );

        // Award points + notify user
        let playgroundAfter = null;
        if (item.submittedByUserId) {
            playgroundAfter = await db.collection("playgrounds").findOne({ _id: new ObjectId(item.playgroundId) });
            await contributionService.recordContribution(item.submittedByUserId, 'PLAYGROUND_EDIT', item.playgroundId, playgroundAfter?.city);
            await notifyUser(db, item.submittedByUserId, `Your edit to "${item.playgroundName}" was approved! You earned points.`);
        }

        if (item.submittedByUserId && playgroundAfter) {
            const rawPid = item.playgroundId;
            const pid = rawPid && typeof rawPid.toHexString === 'function'
                ? rawPid.toHexString()
                : String(rawPid);
            try {
                await recordVerificationFromPlaygroundEdit(db, pid, item.submittedByUserId, playgroundAfter);
            } catch (e) {
                console.warn('[approve-edit] verification side-effect failed:', e.message);
            }
        }

        moderationStatsService.recordOutcomeFromQueueItem(item, 'approved').catch(() => {});

        res.json({ message: "Edit approved and applied" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/moderation/:id/reject-edit
router.post("/moderation/:id/reject-edit", verifyAdminToken, async (req, res) => {
    const db = getDb();
    const { reason } = req.body || {};
    try {
        const item = await db.collection("moderation_queue").findOne({ _id: new ObjectId(req.params.id) });
        if (!item) return res.status(404).json({ error: "Item not found" });

        await db.collection("moderation_queue").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'REJECTED', reason: reason || null, reviewedAt: new Date(), reviewedBy: req.user.uid } }
        );

        if (item.submittedByUserId) {
            const msg = reason
                ? `Your edit to "${item.playgroundName}" was not approved. Reason: ${reason}`
                : `Your edit to "${item.playgroundName}" was not approved.`;
            await notifyUser(db, item.submittedByUserId, msg);
        }

        moderationStatsService.recordOutcomeFromQueueItem(item, 'rejected').catch(() => {});

        res.json({ message: "Edit rejected" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Seed Review Queue ────────────────────────────────────────────────────────

// GET /admin/seed-review?regionKey=omaha-ne&status=PENDING_SEED_REVIEW
router.get('/seed-review', async (req, res) => {
    const db = getDb();
    const { regionKey, status = 'PENDING_SEED_REVIEW' } = req.query;
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    try {
        const filter = { status };
        if (regionKey) filter.regionKey = regionKey;
        const items = await db.collection('seed_review_queue')
            .find(filter)
            .sort({ isTopPhoto: -1, createdAt: -1 })
            .limit(200)
            .toArray();

        // Resolve google_photo: references to real HTTPS URLs
        const resolved = items.map(i => {
            let photoUrl = i.photoUrl || '';
            if (photoUrl.startsWith('google_photo:')) {
                const ref = photoUrl.split(':')[1];
                photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photoreference=${ref}&key=${GOOGLE_MAPS_API_KEY}`;
            }
            return { ...i, id: i._id.toHexString(), photoUrl };
        });

        res.json({ message: 'success', data: resolved });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /admin/seed-review/regions — list regions with pending seed review items
router.get('/seed-review/regions', async (req, res) => {
    const db = getDb();
    try {
        const regions = await db.collection('seed_review_queue').aggregate([
            { $match: { status: 'PENDING_SEED_REVIEW' } },
            { $group: { _id: '$regionKey', count: { $sum: 1 }, topPhotoCount: { $sum: { $cond: ['$isTopPhoto', 1, 0] } } } },
            { $sort: { count: -1 } }
        ]).toArray();
        res.json({ message: 'success', data: regions });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/seed-review/:id/approve — approve a seed photo (mark as hero or keep in gallery)
router.post('/seed-review/:id/approve', async (req, res) => {
    const db = getDb();
    const { setAsHero } = req.body || {};
    try {
        const item = await db.collection('seed_review_queue').findOne({ _id: new ObjectId(req.params.id) });
        if (!item) return res.status(404).json({ error: 'Seed review item not found' });

        await db.collection('seed_review_queue').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'APPROVED', reviewedAt: new Date(), reviewedBy: req.user.uid } }
        );

        if (setAsHero) {
            // Move this photo to the front of the playground's imageUrls
            const playground = await db.collection('playgrounds').findOne({ _id: item.playgroundId });
            if (playground) {
                const urls = playground.imageUrls || [];
                const reordered = [item.photoUrl, ...urls.filter(u => u !== item.photoUrl)];
                await db.collection('playgrounds').updateOne(
                    { _id: item.playgroundId },
                    { $set: { imageUrls: reordered } }
                );
            }
        }

        res.json({ message: 'Seed photo approved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/seed-review/:id/reject — remove photo from playground gallery
router.post('/seed-review/:id/reject', async (req, res) => {
    const db = getDb();
    const { reason } = req.body || {};
    try {
        const item = await db.collection('seed_review_queue').findOne({ _id: new ObjectId(req.params.id) });
        if (!item) return res.status(404).json({ error: 'Seed review item not found' });

        await db.collection('seed_review_queue').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'REJECTED', reason: reason || null, reviewedAt: new Date(), reviewedBy: req.user.uid } }
        );

        // Remove from playground gallery
        await db.collection('playgrounds').updateOne(
            { _id: item.playgroundId },
            { $pull: { imageUrls: item.photoUrl } }
        );

        res.json({ message: 'Seed photo rejected and removed from gallery' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── One-time backfill: set lastVerifiedAt/Source on seeded parks ─────────────
router.post('/backfill-seed-verification', verifyAdminToken, async (req, res) => {
    const db = getDb();
    try {
        const result = await db.collection('playgrounds').updateMany(
            { lastVerifiedAt: { $exists: false }, verificationCount: { $gte: 1 } },
            [{ $set: { lastVerifiedAt: { $ifNull: ['$createdAt', new Date()] }, lastVerifiedSource: 'seed' } }]
        );
        res.json({ updated: result.modifiedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Diagnostic: inspect a sample of playground records ─────────────────────
router.get('/debug-playgrounds', verifyAdminToken, async (req, res) => {
    const db = getDb();
    try {
        const sample = await db.collection('playgrounds').find({}).limit(5).toArray();
        const total = await db.collection('playgrounds').countDocuments({});
        const withCost = await db.collection('playgrounds').countDocuments({ costRange: { $exists: true, $ne: null, $ne: '' } });
        const missingCost = await db.collection('playgrounds').countDocuments({
            $or: [{ costRange: { $exists: false } }, { costRange: null }, { costRange: '' }]
        });
        res.json({
            total,
            withCost,
            missingCost,
            sample: sample.map(p => ({
                _id: p._id,
                name: p.name,
                costRange: p.costRange ?? '(field missing)',
                googlePlaceId: p.googlePlaceId ?? '(none)',
                lastVerifiedSource: p.lastVerifiedSource ?? '(none)',
                types: p.types,
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── One-time backfill: infer costRange for seeded parks ─────────────────────
// Pass ?overwrite=true to re-infer even records that already have a costRange set.
router.post('/backfill-seed-cost', verifyAdminToken, async (req, res) => {
    const db = getDb();
    const overwrite = req.query.overwrite === 'true';
    try {
        // Pull all seeded parks (have a googlePlaceId); optionally only those missing costRange
        const filter = overwrite
            ? { googlePlaceId: { $exists: true } }
            : {
                googlePlaceId: { $exists: true },
                $or: [
                    { costRange: { $exists: false } },
                    { costRange: null },
                    { costRange: '' }
                ]
              };
        const places = await db.collection('playgrounds').find(filter, { projection: { _id: 1, name: 1, types: 1, costRange: 1 } }).toArray();

        const freeTypes = ['park', 'natural_feature', 'campground'];
        const freeNameKeywords = ['elementary', 'school', 'public park', 'city park', 'county park', 'neighborhood park', 'community park'];
        const paidTypes = ['amusement_park', 'museum', 'zoo', 'aquarium', 'arcade', 'amusement_arcade'];
        const paidNameKeywords = ['indoor', 'trampoline', 'bounce', 'play place', 'fun zone', 'adventure', 'discovery', 'science center', "children's museum"];

        let updated = 0;
        for (const p of places) {
            const typesLower = (p.types || []).map(t => t.toLowerCase());
            const nameLower = (p.name || '').toLowerCase();
            const isPaid = paidTypes.some(t => typesLower.includes(t)) || paidNameKeywords.some(kw => nameLower.includes(kw));
            const isFree = freeTypes.some(t => typesLower.includes(t)) || freeNameKeywords.some(kw => nameLower.includes(kw));
            const cost = isPaid ? 'Unknown' : isFree ? 'Free' : null;
            if (cost !== null) {
                await db.collection('playgrounds').updateOne({ _id: p._id }, { $set: { costRange: cost } });
                updated++;
            }
        }
        res.json({ scanned: places.length, updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Re-infer playgroundType (after seeding or when classification rules change) ─
// Body/query: dryRun (default true), scope (seeded|missing|stale_on_seed|recheck_seed|all),
// regionKey (optional), limit (optional, max 5000 per request)
router.post('/playgrounds/recategorize-types', async (req, res) => {
    const db = getDb();
    const body = req.body || {};
    const dryRun = body.dryRun !== false && req.query.dryRun !== 'false';
    const scope = body.scope || req.query.scope || 'seeded';
    const regionKey = body.regionKey || req.query.regionKey || undefined;
    let limit = body.limit != null ? parseInt(body.limit, 10) : parseInt(req.query.limit || '', 10);
    if (Number.isNaN(limit)) limit = undefined;
    const maxPerRequest = 5000;
    if (limit != null && limit > maxPerRequest) {
        return res.status(400).json({ error: `limit must be <= ${maxPerRequest}` });
    }
    const allowed = new Set(['seeded', 'missing', 'stale_on_seed', 'recheck_seed', 'all']);
    if (!allowed.has(scope)) {
        return res.status(400).json({
            error: `scope must be one of: ${[...allowed].join(', ')}`,
        });
    }
    try {
        const result = await recategorizePlaygroundTypes({
            db,
            dryRun,
            scope,
            regionKey,
            limit,
            sampleChanges: dryRun ? Math.min(40, maxPerRequest) : 0,
        });
        res.json({ message: 'success', data: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Reseed Region ────────────────────────────────────────────────────────────

// Known center coords — add more regions here as needed
const REGION_COORDS = {
    'omaha-ne':   { lat: 41.2565, lng: -95.9345 },
    'lincoln-ne': { lat: 40.8136, lng: -96.7026 },
};

// POST /admin/expand-region
// Additively fetches more places for one, several, or all seeded regions — no wipe.
// Body: { regionKeys: ["omaha-ne"] }  — omit or pass [] to expand ALL seeded regions
//       radiusMeters: 24140           — optional, defaults to 24140 (~15 miles)
router.post('/expand-region', async (req, res) => {
    const db = getDb();
    const { regionKeys: requestedKeys, radiusMeters = 24140 } = req.body || {};

    // Resolve which regions to expand
    let targetKeys;
    if (!requestedKeys || requestedKeys.length === 0) {
        const all = await db.collection('seeded_regions').find({}, { projection: { regionKey: 1 } }).toArray();
        targetKeys = all.map(r => r.regionKey);
    } else {
        targetKeys = requestedKeys;
    }

    if (targetKeys.length === 0) {
        return res.status(400).json({ error: 'No seeded regions found to expand' });
    }

    const results = [];
    const errors = [];

    // Fire all expansions non-blocking and respond immediately
    res.json({
        message: 'success',
        data: {
            expanding: targetKeys,
            radiusMeters,
            note: 'Expansion running in background — new places will appear as they are inserted'
        }
    });

    for (const regionKey of targetKeys) {
        try {
            const result = await seedOrchestratorService.expandRegion(regionKey, radiusMeters, req.user.uid);
            console.log(`[expand-region] ${regionKey}: inserted ${result.inserted} of ${result.scanned} scanned`);
        } catch (err) {
            console.error(`[expand-region] failed for ${regionKey}:`, err.message);
        }
    }
});

// POST /admin/reseed-all
// Wipes and reseeds every region that has coords configured in REGION_COORDS.
router.post('/reseed-all', async (req, res) => {    const db = getDb();
    const collections = ['playgrounds', 'seed_review_queue', 'seed_jobs', 'city_advertising_status'];
    const regionKeys = Object.keys(REGION_COORDS);
    const wiped = [];
    const seeding = [];
    const errors = [];

    for (const regionKey of regionKeys) {
        try {
            for (const col of collections) {
                await db.collection(col).deleteMany({ regionKey });
            }
            await db.collection('seeded_regions').deleteOne({ regionKey });
            wiped.push(regionKey);

            const coords = REGION_COORDS[regionKey];
            seedOrchestratorService.handleHybridSearch(coords.lat, coords.lng, req.user.uid)
                .catch(err => console.error(`[reseed-all] handleHybridSearch failed for ${regionKey}:`, err.message));
            seeding.push(regionKey);
        } catch (err) {
            errors.push({ regionKey, error: err.message });
        }
    }

    res.json({
        message: 'success',
        data: { wiped, seeding, ...(errors.length > 0 ? { errors } : {}) }
    });
});

// POST /admin/trim-galleries
// Scores all photos for playgrounds over the limit and soft-deletes the lowest-scoring ones.
// Body: { regionKey: "omaha-ne", maxPhotos: 25, dryRun: true }
// Omit regionKey to run across all regions. dryRun defaults to false.
router.post('/trim-galleries', async (req, res) => {
    const { regionKey, maxPhotos = 25, dryRun = false } = req.body || {};
    // Respond immediately — this can take a while
    res.json({
        message: 'success',
        data: { regionKey: regionKey || 'all', maxPhotos, dryRun, note: 'Gallery trim running in background' }
    });
    try {
        const result = await seedOrchestratorService.trimPhotoGalleries({ regionKey, maxPhotos, dryRun });
        console.log(`[trim-galleries] Complete:`, result);
    } catch (err) {
        console.error(`[trim-galleries] Failed:`, err.message);
    }
});

// POST /admin/reseed-region
// Body: { regionKeys: ["omaha-ne", "lincoln-ne"] }// Wipes all seeded data for each region and triggers a fresh seed.
router.post('/reseed-region', async (req, res) => {
    const db = getDb();
    const { regionKeys } = req.body || {};

    if (!Array.isArray(regionKeys) || regionKeys.length === 0) {
        return res.status(400).json({ error: 'regionKeys must be a non-empty array' });
    }

    const collections = ['playgrounds', 'seed_review_queue', 'seed_jobs', 'city_advertising_status'];
    const wiped = [];
    const seeding = [];
    const errors = [];

    for (const regionKey of regionKeys) {
        try {
            // Hard-delete all seeded data for this region
            for (const col of collections) {
                await db.collection(col).deleteMany({ regionKey });
            }
            await db.collection('seeded_regions').deleteOne({ regionKey });
            wiped.push(regionKey);

            // Trigger fresh seed (non-blocking)
            const coords = REGION_COORDS[regionKey];
            if (coords) {
                seedOrchestratorService.handleHybridSearch(coords.lat, coords.lng, req.user.uid)
                    .catch(err => console.error(`[reseed] handleHybridSearch failed for ${regionKey}:`, err.message));
                seeding.push(regionKey);
            } else {
                errors.push({ regionKey, error: 'No coords configured — wiped but not reseeded' });
            }
        } catch (err) {
            errors.push({ regionKey, error: err.message });
        }
    }

    res.json({
        message: 'success',
        data: { wiped, seeding, ...(errors.length > 0 ? { errors } : {}) }
    });
});

// ─── Equipment Mismatch Endpoints ────────────────────────────────────────────

router.get('/equipment-mismatches', verifyAdminToken, async (req, res) => {
    try {
        const db = getDb();
        const filter = {
            'photoValidation.dataQualityScore': { $lt: 0.5 },
        };
        if (req.query.regionKey) filter.regionKey = req.query.regionKey;

        const playgrounds = await db.collection('playgrounds').find(filter).toArray();

        // Filter to those with >= 2 total mismatches
        const results = playgrounds.filter(p => {
            const pv = p.photoValidation || {};
            const mismatches =
                ((pv.missingFromRecord?.equipment) || []).length +
                ((pv.missingFromRecord?.swingTypes) || []).length +
                ((pv.missingFromRecord?.sportsCourts) || []).length +
                ((pv.missingFromRecord?.amenities) || []).length +
                ((pv.noPhotoEvidence?.equipment) || []).length +
                ((pv.noPhotoEvidence?.swingTypes) || []).length +
                ((pv.noPhotoEvidence?.sportsCourts) || []).length +
                ((pv.noPhotoEvidence?.amenities) || []).length;
            return mismatches >= 2;
        }).map(p => ({
            id: p._id,
            name: p.name,
            regionKey: p.regionKey,
            photoValidation: p.photoValidation,
            imageUrls: (p.imageUrls || []).slice(0, 3),
        }));

        res.json({ mismatches: results, count: results.length });
    } catch (err) {
        console.error('[admin] equipment-mismatches error:', err.message);
        res.status(500).json({ error: 'Failed to fetch equipment mismatches' });
    }
});

router.post('/equipment-mismatches/:id/resolve', verifyAdminToken, async (req, res) => {
    try {
        const db = getDb();
        const playgroundId = req.params.id;
        const corrections = req.body.corrections || {};

        if (Object.keys(corrections).length === 0) {
            return res.status(400).json({ error: 'No corrections provided' });
        }

        // Apply corrections to the playground record
        await db.collection('playgrounds').updateOne(
            { _id: playgroundId },
            { $set: corrections },
        );

        // Re-read and revalidate
        const updated = await db.collection('playgrounds').findOne({ _id: playgroundId });
        if (!updated) return res.status(404).json({ error: 'Playground not found' });

        // Build aggregated detections from existing photoValidation
        const pv = updated.photoValidation || {};
        const aggregatedDetections = {
            equipment: [...new Set([
                ...((pv.confirmed?.equipment) || []),
                ...((pv.missingFromRecord?.equipment) || []),
            ])],
            swingTypes: [...new Set([
                ...((pv.confirmed?.swingTypes) || []),
                ...((pv.missingFromRecord?.swingTypes) || []),
            ])],
            sportsCourts: [...new Set([
                ...((pv.confirmed?.sportsCourts) || []),
                ...((pv.missingFromRecord?.sportsCourts) || []),
            ])],
            amenities: [...new Set([
                ...((pv.confirmed?.amenities) || []),
                ...((pv.missingFromRecord?.amenities) || []),
            ])],
            groundSurface: pv.confirmed?.groundSurface || pv.missingFromRecord?.groundSurface || null,
        };

        const newReport = validate(aggregatedDetections, updated, pv.photoCount || 0);
        await db.collection('playgrounds').updateOne(
            { _id: playgroundId },
            { $set: { photoValidation: newReport } },
        );

        res.json({ success: true, photoValidation: newReport });
    } catch (err) {
        console.error('[admin] equipment-mismatches resolve error:', err.message);
        res.status(500).json({ error: 'Failed to resolve equipment mismatch' });
    }
});

// ─── Region Management ────────────────────────────────────────────────────────

// POST /admin/location-overrides — force normalized city labels for a Google Place ID
router.post('/location-overrides', async (req, res) => {
    try {
        const { googlePlaceId, forcedCityDisplay, forcedCitySlug, forcedStateCode, note } = req.body || {};
        if (!googlePlaceId || !forcedCityDisplay) {
            return res.status(400).json({ error: 'googlePlaceId and forcedCityDisplay are required' });
        }
        const db = getDb();
        const now = new Date();
        const doc = {
            googlePlaceId: String(googlePlaceId).trim(),
            forcedCityDisplay: String(forcedCityDisplay).trim(),
            forcedCitySlug: forcedCitySlug != null && String(forcedCitySlug).trim()
                ? String(forcedCitySlug).trim().toLowerCase()
                : null,
            forcedStateCode:
                forcedStateCode != null && String(forcedStateCode).trim()
                    ? String(forcedStateCode).trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
                    : null,
            note: note != null ? String(note).slice(0, 500) : null,
            updatedAt: now,
        };
        await db.collection('locationOverrides').updateOne(
            { googlePlaceId: doc.googlePlaceId },
            { $set: doc },
            { upsert: true },
        );
        res.json({ message: 'success', data: { googlePlaceId: doc.googlePlaceId } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/regions/:regionKey/mark-stale — operator flags a metro for re-seed (calendar + activity signal)
router.post('/regions/:regionKey/mark-stale', async (req, res) => {
  try {
    const { regionKey } = req.params;
    const reason = req.body?.reason != null ? String(req.body.reason).slice(0, 500) : null;
    const db = getDb();
    const now = new Date();
    const r = await db.collection('seeded_regions').updateOne(
      { regionKey },
      {
        $set: {
          forceStale: true,
          staleReason: reason,
          staleRequestedAt: now,
          staleRequestedBy: req.user?.uid ?? null,
        },
      },
    );
    if (r.matchedCount === 0) {
      return res.status(404).json({ error: `Region not found: ${regionKey}` });
    }
    await appendRunLog(db, {
      regionKey,
      runType: 'mark_region_stale',
      meta: { reason, requestedBy: req.user?.uid ?? null },
    });
    const region = await db.collection('seeded_regions').findOne({ regionKey });
    const queued = await enqueueLightRefreshIfNeeded(db, region, {
      requestedBy: 'admin',
      requestedByUserId: req.user?.uid || null,
    });
    if (queued.enqueued) {
      setImmediate(() => {
        runLightRefresh(regionKey).catch((err) =>
          console.error(`[mark-stale] light-refresh ${regionKey}:`, err.message),
        );
      });
    }
    res.json({
      message: 'success',
      data: { regionKey, forceStale: true, lightRefresh: queued },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/regions/:regionKey/backfill-seed-tiles — upsert `seed_tiles` from existing playground points (no deletes)
router.post('/regions/:regionKey/backfill-seed-tiles', async (req, res) => {
  try {
    const { regionKey } = req.params;
    const db = getDb();
    const out = await seedTileService.backfillTilesFromPlaygrounds(regionKey, db);
    await appendRunLog(db, {
      regionKey,
      runType: 'backfill_seed_tiles',
      meta: out,
    });
    res.json({ message: 'success', data: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/regions — list all seeded regions (placeCount = live non-archived playground count)
router.get('/regions', async (req, res) => {
    const db = getDb();
    const { countActivePlaygroundsByRegionKeys } = require('../services/regionStatsService');
    try {
        const regions = await db.collection('seeded_regions')
            .find({})
            .sort({ city: 1 })
            .project({ regionKey: 1, city: 1, displayCity: 1, state: 1, seedStatus: 1, seededAt: 1 })
            .toArray();
        const keys = regions.map((r) => r.regionKey).filter(Boolean);
        const counts = await countActivePlaygroundsByRegionKeys(db, keys);
        const data = regions.map((r) => ({
            ...r,
            placeCount: counts.get(r.regionKey) ?? 0,
        }));
        res.json({ message: 'success', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/regions/seed — trigger seeding for a new city
router.post('/regions/seed', async (req, res) => {
    const { city, state } = req.body;
    if (!city || !state) {
        return res.status(400).json({ error: 'city and state are required' });
    }

    try {
        const inputCity = city.trim();
        const inputState = state.trim();
        const regionKey = seedOrchestratorService.normalizeRegionKey(inputCity, inputState);
        const db = getDb();

        // Check if this location is already covered by an existing region
        const geoResult = await seedOrchestratorService.geocodeTextQuery(`${inputCity}, ${inputState}`);
        const center = { lat: geoResult.lat, lng: geoResult.lng };
        
        const existingRegions = await db.collection('seeded_regions').find({
            seedStatus: { $nin: ['failed', 'running'] },
            $or: [
                { center: { $exists: true } },
                { 'center.coordinates': { $exists: true } }
            ]
        }).toArray();

        let coveredBy = null;
        for (const reg of existingRegions) {
            const regCenter = seedOrchestratorService.seededRegionCenterToLatLng(reg.center);
            if (!regCenter) continue;
            
            // Check if the new location is within 5 miles of an existing region center
            const dist = venueMergeService.haversineMeters(
                center.lat, center.lng,
                regCenter.lat, regCenter.lng
            );
            if (dist < 8047) { // 5 miles in meters
                coveredBy = { regionKey: reg.regionKey, distanceMeters: Math.round(dist) };
                break;
            }
        }

        if (coveredBy) {
            return res.json({ 
                regionKey, 
                seedingTriggered: false, 
                message: `This area is already covered by ${coveredBy.regionKey} (${(coveredBy.distanceMeters / 1609).toFixed(1)} miles away)`,
                coveredBy: coveredBy.regionKey
            });
        }

        const existing = await db.collection('seeded_regions').findOne({ regionKey });

        if (existing && existing.seedStatus !== 'failed') {
            return res.json({ regionKey, seedingTriggered: false, message: 'Region already seeded' });
        }

        // Trigger the seed and wait for it to start
        await seedOrchestratorService.handleHybridSearch(geoResult.lat, geoResult.lng, req.user.uid);

        res.json({ regionKey, seedingTriggered: true, message: 'Seeding started' });
    } catch (err) {
        console.error(`[admin-seed] error for ${req.body.city}, ${req.body.state}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /admin/regions/:regionKey — wipe a seeded region without re-seeding
router.delete('/regions/:regionKey', async (req, res) => {
    const { regionKey } = req.params;
    if (!regionKey) return res.status(400).json({ error: 'regionKey is required' });

    const db = getDb();
    try {
        const region = await db.collection('seeded_regions').findOne({ regionKey });
        if (!region) return res.status(404).json({ error: `Region "${regionKey}" not found` });

        // Delete all related data
        const [playgrounds, seedReview, seedJobs, advertising] = await Promise.all([
            db.collection('playgrounds').deleteMany({ regionKey }),
            db.collection('seed_review_queue').deleteMany({ regionKey }),
            db.collection('seed_jobs').deleteMany({ regionKey }),
            db.collection('city_advertising_status').deleteMany({ regionKey }),
        ]);
        await db.collection('seeded_regions').deleteOne({ regionKey });

        res.json({
            message: 'success',
            deleted: {
                regionKey,
                playgrounds: playgrounds.deletedCount,
                seedReviewItems: seedReview.deletedCount,
                seedJobs: seedJobs.deletedCount,
                advertisingRecords: advertising.deletedCount,
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Venue Merge Endpoints ────────────────────────────────────────────────────

// POST /admin/merge-region — trigger proximity dedup + sub-venue grouping
// Body: { regionKey, dryRun?, distanceMeters? } — distanceMeters defaults to 100 in the service
router.post('/merge-region', async (req, res) => {
    const { regionKey, dryRun = false, distanceMeters: dmRaw } = req.body || {};
    if (!regionKey) return res.status(400).json({ error: 'regionKey is required' });
    let distanceMeters = dmRaw != null ? parseInt(dmRaw, 10) : undefined;
    if (distanceMeters != null && Number.isNaN(distanceMeters)) {
        return res.status(400).json({ error: 'distanceMeters must be a number' });
    }
    const dedupOpts = { dryRun };
    if (distanceMeters != null && !Number.isNaN(distanceMeters)) dedupOpts.distanceMeters = distanceMeters;
    try {
        let dedupResult = null;
        let groupResult = { grouped: 0, parents: [], campusGrouped: 0, parkGrouped: 0 };
        let crossRegionResult = null;
        if (dryRun) {
            const [dedupPreview, campusPreview, parkPreview, addressPreview] = await Promise.all([
                venueMergeService.proximityDedup(regionKey, dedupOpts),
                venueMergeService.previewCampusClusters(regionKey),
                venueMergeService.previewParkAmenityClusters(regionKey),
                venueMergeService.previewAddressSubvenueGroups(regionKey),
            ]);
            dedupResult = dedupPreview;
            groupResult = {
                dryRun: true,
                campusClusters: campusPreview.clusters,
                campusClusterCount: campusPreview.clusterCount,
                parkClusters: parkPreview.clusters,
                parkClusterCount: parkPreview.clusterCount,
                addressClusters: addressPreview.clusters,
                addressClusterCount: addressPreview.clusterCount,
            };
        } else {
            const result = await venueMergeService.canonicalizeRegionVenues(regionKey, {
                distanceMeters,
            });
            dedupResult = result.dedup;
            groupResult = result.grouping;
            crossRegionResult = result.crossRegion;
        }
        res.json({
            message: 'success',
            data: { dedup: dedupResult, subVenueGrouping: groupResult, crossRegion: crossRegionResult },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /admin/merge-preview — dry-run: proximity dedup + campus + address sub-venue previews (no writes)
// Query: regionKey (required), distanceMeters (optional, same semantics as merge-region)
router.get('/merge-preview', async (req, res) => {
    const { regionKey } = req.query;
    if (!regionKey) return res.status(400).json({ error: 'regionKey query param is required' });
    let distanceMeters = req.query.distanceMeters != null ? parseInt(req.query.distanceMeters, 10) : undefined;
    if (distanceMeters != null && Number.isNaN(distanceMeters)) {
        return res.status(400).json({ error: 'distanceMeters must be a number' });
    }
    const dedupOpts = { dryRun: true };
    if (distanceMeters != null && !Number.isNaN(distanceMeters)) dedupOpts.distanceMeters = distanceMeters;
    try {
        const [dedupPreview, campusPreview, parkPreview, addressPreview] = await Promise.all([
            venueMergeService.proximityDedup(regionKey, dedupOpts),
            venueMergeService.previewCampusClusters(regionKey),
            venueMergeService.previewParkAmenityClusters(regionKey),
            venueMergeService.previewAddressSubvenueGroups(regionKey),
        ]);
        res.json({
            message: 'success',
            data: {
                ...dedupPreview,
                campusClusters: campusPreview.clusters,
                campusClusterCount: campusPreview.clusterCount,
                parkClusters: parkPreview.clusters,
                parkClusterCount: parkPreview.clusterCount,
                addressClusters: addressPreview.clusters,
                addressClusterCount: addressPreview.clusterCount,
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /admin/merge-cross-region-preview — dry-run: same-address clusters spanning multiple regionKey (no writes)
// Query: maxDistanceMeters (optional, default 150), requireDistinctRegions (optional, default true)
router.get('/merge-cross-region-preview', async (req, res) => {
    let maxDistanceMeters =
        req.query.maxDistanceMeters != null ? parseInt(req.query.maxDistanceMeters, 10) : 150;
    if (Number.isNaN(maxDistanceMeters) || maxDistanceMeters < 0) {
        return res.status(400).json({ error: 'maxDistanceMeters must be a non-negative number' });
    }
    const rdr = req.query.requireDistinctRegions;
    const requireDistinctRegions =
        rdr === undefined || rdr === '' ? true : String(rdr).toLowerCase() !== 'false';
    try {
        const preview = await venueMergeService.crossRegionAddressDedup({
            dryRun: true,
            maxDistanceMeters,
            requireDistinctRegions,
        });
        res.json({ message: 'success', data: preview });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/merge-cross-region-addresses — merge cross-region duplicates by normalized address + distance
// Body: { dryRun?, maxDistanceMeters?, requireDistinctRegions? }
router.post('/merge-cross-region-addresses', async (req, res) => {
    const { dryRun = false, maxDistanceMeters: dmRaw, requireDistinctRegions: rdrRaw } = req.body || {};
    let maxDistanceMeters = dmRaw != null ? parseInt(dmRaw, 10) : 150;
    if (Number.isNaN(maxDistanceMeters) || maxDistanceMeters < 0) {
        return res.status(400).json({ error: 'maxDistanceMeters must be a non-negative number' });
    }
    let requireDistinctRegions = true;
    if (rdrRaw !== undefined && rdrRaw !== null) {
        if (typeof rdrRaw === 'boolean') requireDistinctRegions = rdrRaw;
        else {
            const s = String(rdrRaw).toLowerCase();
            requireDistinctRegions = !(s === 'false' || s === '0');
        }
    }
    try {
        const result = await venueMergeService.crossRegionAddressDedup({
            dryRun: Boolean(dryRun),
            maxDistanceMeters,
            requireDistinctRegions,
        });
        res.json({ message: 'success', data: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/link-subvenues — manually link child venues under a parent
router.post('/link-subvenues', async (req, res) => {
    const { parentId, childIds } = req.body || {};
    if (!parentId || !Array.isArray(childIds) || childIds.length === 0) {
        return res.status(400).json({ error: 'parentId and childIds (non-empty array) are required' });
    }
    try {
        const result = await venueMergeService.linkSubVenues(parentId, childIds);
        res.json({ message: 'success', data: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/unlink-subvenue — restore a sub-venue as independent
router.post('/unlink-subvenue', async (req, res) => {
    const { parentId, childId } = req.body || {};
    if (!parentId || !childId) {
        return res.status(400).json({ error: 'parentId and childId are required' });
    }
    try {
        const result = await venueMergeService.unlinkSubVenue(parentId, childId);
        res.json({ message: 'success', data: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/unarchive-playground — restore an archived playground to active
router.post('/unarchive-playground', async (req, res) => {
    const { playgroundId } = req.body || {};
    if (!playgroundId) {
        return res.status(400).json({ error: 'playgroundId is required' });
    }
    try {
        const db = getDb();
        const archived = await db.collection('archived_playgrounds').findOne({ _id: playgroundId });
        if (!archived) {
            return res.status(404).json({ error: 'Playground not found in archived_playgrounds' });
        }
        
        // Remove archiveInfo to restore to original state
        const { archiveInfo, ...originalDoc } = archived;
        
        // Insert back to playgrounds collection
        await db.collection('playgrounds').insertOne(originalDoc);
        
        // Delete from archived_playgrounds
        await db.collection('archived_playgrounds').deleteOne({ _id: playgroundId });
        
        res.json({ 
            message: 'success', 
            data: {
                id: originalDoc._id,
                name: originalDoc.name,
                regionKey: originalDoc.regionKey,
                status: originalDoc.status
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /admin/playgrounds/:id/merge-audit — merge type explanation + archived rows (addresses)
router.get('/playgrounds/:id/merge-audit', async (req, res) => {
    try {
        const data = await venueMergeService.getMergeAudit(req.params.id);
        res.json({ message: 'success', data });
    } catch (err) {
        const msg = err.message || String(err);
        const status = msg === 'Playground not found' ? 404 : 400;
        res.status(status).json({ error: msg });
    }
});

// ─── User Blocking / Banning ──────────────────────────────────────────────────

// GET /admin/users — list users with optional status filter
router.get('/users', async (req, res) => {
    const db = getDb();
    const { status, limit = 50, cursor } = req.query;
    try {
        const query = {};
        if (status === 'blocked') query.blockedAt = { $exists: true };
        if (status === 'banned') query.bannedAt = { $exists: true };
        if (status === 'active') {
            query.blockedAt = { $exists: false };
            query.bannedAt = { $exists: false };
        }
        if (cursor) query._id = { $gt: cursor };

        const users = await db.collection('users')
            .find(query)
            .sort({ _id: 1 })
            .limit(parseInt(limit))
            .project({
                email: 1, displayName: 1, role: 1, score: 1, level: 1,
                blockedAt: 1, blockedReason: 1, bannedAt: 1, bannedReason: 1, regionKey: 1,
                forceManualReview: 1, forceManualReviewReason: 1, forceManualReviewAt: 1,
                moderationStats: 1,
            })
            .toArray();

        const nextCursor = users.length === parseInt(limit) ? users[users.length - 1]._id : null;
        res.json({ message: 'success', data: users, nextCursor });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /admin/users/:userId/moderation-summary — approve/reject counts + rolling rejections
router.get('/users/:userId/moderation-summary', async (req, res) => {
    const { userId } = req.params;
    try {
        const data = await moderationStatsService.getModerationSummaryForUser(userId);
        res.json({ message: 'success', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/users/:userId/block — temporarily block a user
router.post('/users/:userId/block', async (req, res) => {
    const db = getDb();
    const { userId } = req.params;
    const { reason } = req.body || {};
    if (!reason) return res.status(400).json({ error: 'reason is required' });

    try {
        const user = await db.collection('users').findOne({ _id: userId });
        if (!user) return res.status(404).json({ error: 'User not found' });

        await db.collection('users').updateOne(
            { _id: userId },
            { $set: { blockedAt: new Date(), blockedReason: reason, blockedBy: req.user.uid } }
        );
        await notifyUser(db, userId, `Your account has been temporarily blocked. Reason: ${reason}`);
        res.json({ message: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/users/:userId/unblock — remove a block
router.post('/users/:userId/unblock', async (req, res) => {
    const db = getDb();
    const { userId } = req.params;
    try {
        await db.collection('users').updateOne(
            { _id: userId },
            { $unset: { blockedAt: '', blockedReason: '', blockedBy: '' } }
        );
        await notifyUser(db, userId, 'Your account block has been lifted. Welcome back!');
        res.json({ message: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/users/:userId/ban — permanently ban a user
router.post('/users/:userId/ban', async (req, res) => {
    const db = getDb();
    const { userId } = req.params;
    const { reason } = req.body || {};
    if (!reason) return res.status(400).json({ error: 'reason is required' });

    try {
        const user = await db.collection('users').findOne({ _id: userId });
        if (!user) return res.status(404).json({ error: 'User not found' });

        await db.collection('users').updateOne(
            { _id: userId },
            { $set: { bannedAt: new Date(), bannedReason: reason, bannedBy: req.user.uid } }
        );

        // Disable the Firebase Auth account so they can't log in
        try {
            const admin = require('firebase-admin');
            await admin.auth().updateUser(userId, { disabled: true });
        } catch (fbErr) {
            console.warn(`[ban] Could not disable Firebase user ${userId}:`, fbErr.message);
        }

        await notifyUser(db, userId, `Your account has been permanently banned. Reason: ${reason}`);
        res.json({ message: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/users/:userId/unban — reverse a ban
router.post('/users/:userId/unban', async (req, res) => {
    const db = getDb();
    const { userId } = req.params;
    try {
        await db.collection('users').updateOne(
            { _id: userId },
            { $unset: { bannedAt: '', bannedReason: '', bannedBy: '' } }
        );

        // Re-enable the Firebase Auth account
        try {
            const admin = require('firebase-admin');
            await admin.auth().updateUser(userId, { disabled: false });
        } catch (fbErr) {
            console.warn(`[unban] Could not re-enable Firebase user ${userId}:`, fbErr.message);
        }

        await notifyUser(db, userId, 'Your account ban has been reversed. Welcome back!');
        res.json({ message: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/users/:userId/review-required — force or clear mandatory review on submissions
router.post('/users/:userId/review-required', async (req, res) => {
    const db = getDb();
    const { userId } = req.params;
    const enabled = req.body?.enabled === true;
    const reason = req.body?.reason != null ? String(req.body.reason).trim() : '';
    try {
        const user = await db.collection('users').findOne({ _id: userId }, { projection: { _id: 1 } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (enabled) {
            await db.collection('users').updateOne(
                { _id: userId },
                {
                    $set: {
                        forceManualReview: true,
                        forceManualReviewReason: reason || null,
                        forceManualReviewAt: new Date(),
                        forceManualReviewBy: req.user.uid,
                    },
                },
            );
            return res.json({ message: 'success', data: { userId, forceManualReview: true } });
        }

        await db.collection('users').updateOne(
            { _id: userId },
            {
                $unset: {
                    forceManualReview: '',
                    forceManualReviewReason: '',
                    forceManualReviewAt: '',
                    forceManualReviewBy: '',
                },
            },
        );
        return res.json({ message: 'success', data: { userId, forceManualReview: false } });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// DELETE /admin/playgrounds/:id — admin direct archive/delete
router.delete('/playgrounds/:id', async (req, res) => {
    const db = getDb();
    const { id } = req.params;
    try {
        const oid = new ObjectId(id);
        const result = await db.collection('playgrounds').updateOne(
            { _id: oid, archivedAt: { $exists: false } },
            {
                $set: {
                    archivedAt: new Date(),
                    archivedByAdminId: req.user.uid,
                    archivedReason: 'Admin direct delete',
                }
            }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Playground not found or already archived' });
        }
        return res.json({ message: 'success' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// POST /admin/playgrounds/reassign-region — set regionKey for all playgrounds in source (merge cities)
// Body: { fromRegionKey: "richland-ne", targetRegionKey: "omaha-ne", dryRun: true }
router.post('/playgrounds/reassign-region', async (req, res) => {
    const db = getDb();
    const { fromRegionKey, targetRegionKey, dryRun = false } = req.body || {};
    if (!fromRegionKey || !targetRegionKey) {
        return res.status(400).json({ error: 'fromRegionKey and targetRegionKey are required' });
    }
    if (fromRegionKey === targetRegionKey) {
        return res.status(400).json({ error: 'Source and target must differ' });
    }
    try {
        const query = { regionKey: fromRegionKey, archivedAt: { $exists: false } };
        const matched = await db.collection('playgrounds').find(query).project({ _id: 1, name: 1, regionKey: 1 }).toArray();

        if (dryRun) {
            return res.json({
                message: 'success',
                data: {
                    dryRun: true,
                    matchedCount: matched.length,
                    sample: matched.slice(0, 50),
                },
            });
        }

        const updateResult = await db.collection('playgrounds').updateMany(query, {
            $set: {
                regionKey: targetRegionKey,
                updatedAt: new Date(),
                bulkRegionMergeUpdatedBy: req.user.uid,
            },
        });

        return res.json({
            message: 'success',
            data: {
                matchedCount: matched.length,
                modifiedCount: updateResult.modifiedCount,
                fromRegionKey,
                targetRegionKey,
            },
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

/** Escape user text so bulk name match is plain substring, not regex metacharacters. */
function escapeRegExpLiteral(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// POST /admin/playgrounds/bulk-region-tag
// Body: { nameContains: "spare", regionKey: "omaha-ne", dryRun: true }
// Matches playground.name case-insensitively *anywhere* nameContains appears, in *any* current regionKey.
router.post('/playgrounds/bulk-region-tag', async (req, res) => {
    const db = getDb();
    const { nameContains, regionKey, dryRun = false } = req.body || {};
    if (!nameContains || !regionKey) {
        return res.status(400).json({ error: 'nameContains and regionKey are required' });
    }
    try {
        const substring = String(nameContains).trim();
        const regex = new RegExp(escapeRegExpLiteral(substring), 'i');
        const query = { name: regex, archivedAt: { $exists: false } };
        const matched = await db.collection('playgrounds').find(query).project({ _id: 1, name: 1, regionKey: 1 }).toArray();

        if (dryRun) {
            return res.json({
                message: 'success',
                data: {
                    dryRun: true,
                    matchedCount: matched.length,
                    sample: matched.slice(0, 100),
                }
            });
        }

        const updateResult = await db.collection('playgrounds').updateMany(
            query,
            {
                $set: {
                    regionKey,
                    updatedAt: new Date(),
                    bulkRegionTagUpdatedBy: req.user.uid,
                }
            }
        );

        return res.json({
            message: 'success',
            data: {
                matchedCount: matched.length,
                modifiedCount: updateResult.modifiedCount,
                regionKey,
            }
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// POST /admin/playgrounds/bulk-set-playground-type-by-name
// Body: { nameContains: "putt putt", playgroundType: "Mini Golf", dryRun: true }
// Matches name case-insensitively in any region; sets Location type (playgroundType), not regionKey.
router.post('/playgrounds/bulk-set-playground-type-by-name', async (req, res) => {
    const db = getDb();
    const { nameContains, playgroundType, dryRun = false } = req.body || {};
    if (!nameContains || !playgroundType) {
        return res.status(400).json({ error: 'nameContains and playgroundType are required' });
    }
    try {
        const substring = String(nameContains).trim();
        const typeTrim = String(playgroundType).trim();
        if (!typeTrim) {
            return res.status(400).json({ error: 'playgroundType must be non-empty' });
        }
        const regex = new RegExp(escapeRegExpLiteral(substring), 'i');
        const query = { name: regex, archivedAt: { $exists: false } };
        const matched = await db.collection('playgrounds')
            .find(query)
            .project({ _id: 1, name: 1, regionKey: 1, playgroundType: 1 })
            .toArray();

        if (dryRun) {
            return res.json({
                message: 'success',
                data: {
                    dryRun: true,
                    matchedCount: matched.length,
                    playgroundType: typeTrim,
                    sample: matched.slice(0, 100),
                },
            });
        }

        const updateResult = await db.collection('playgrounds').updateMany(
            query,
            {
                $set: {
                    playgroundType: typeTrim,
                    updatedAt: new Date(),
                    bulkPlaygroundTypeByNameAt: new Date(),
                    bulkPlaygroundTypeByNameBy: req.user.uid,
                },
            },
        );

        return res.json({
            message: 'success',
            data: {
                matchedCount: matched.length,
                modifiedCount: updateResult.modifiedCount,
                playgroundType: typeTrim,
            },
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /admin/playgrounds/:id/change-audit — latest change records for a playground
router.get('/playgrounds/:id/change-audit', async (req, res) => {
    const db = getDb();
    const { id } = req.params;
    const limit = req.query.limit || '30';
    try {
        const rows = await listPlaygroundAudits(db, id, limit);
        res.json({
            message: 'success',
            data: rows.map((r) => ({
                ...r,
                id: r._id.toHexString(),
            })),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/change-audit/:id/rollback — rollback one audit change
router.post('/change-audit/:id/rollback', async (req, res) => {
    const db = getDb();
    const { id } = req.params;
    try {
        const out = await rollbackAuditChange(db, id, req.user.uid);
        res.json({ message: 'success', data: out });
    } catch (err) {
        const code = err.statusCode || 500;
        res.status(code).json({ error: err.message });
    }
});

// POST /admin/change-audit/rollback-by-user
// Body:
// {
//   "actorUserId": "uid",
//   "startAt": "2026-04-25T00:00:00Z", // optional
//   "endAt": "2026-04-26T00:00:00Z",   // optional
//   "limit": 200,                      // optional
//   "dryRun": true                     // optional
// }
router.post('/change-audit/rollback-by-user', async (req, res) => {
    const db = getDb();
    const actorUserId = req.body?.actorUserId;
    const startAt = req.body?.startAt;
    const endAt = req.body?.endAt;
    const limit = req.body?.limit;
    const dryRun = req.body?.dryRun === true;
    try {
        const out = await rollbackChangesByUser(db, {
            actorUserId,
            adminUserId: req.user.uid,
            startAt,
            endAt,
            limit,
            dryRun,
        });
        res.json({ message: 'success', data: out });
    } catch (err) {
        const code = err.statusCode || 500;
        res.status(code).json({ error: err.message });
    }
});

module.exports = router;
