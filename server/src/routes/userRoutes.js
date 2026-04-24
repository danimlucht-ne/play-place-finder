const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const contributionService = require('../services/contributionService');
const { publicBucket } = require('../services/storageService');

const SubmissionType = {
    PHOTO: 'PHOTO',
    PLAYGROUND_EDIT: 'PLAYGROUND_EDIT',
    NEW_PLAYGROUND: 'NEW_PLAYGROUND',
    REVIEW: 'REVIEW',
    ISSUE_REPORT: 'ISSUE_REPORT',
    ABUSE_TICKET: 'ABUSE_TICKET'
};

// POST consent acceptance
router.post("/consents", async (req, res) => {
    const db = getDb();
    const { consentType, consentVersion, accepted, appVersion, deviceType } = req.body || {};
    try {
        if (!consentType || typeof consentType !== 'string') {
            return res.status(400).json({ error: "consentType is required." });
        }
        if (!Number.isInteger(consentVersion)) {
            return res.status(400).json({ error: "consentVersion (int) is required." });
        }
        if (typeof accepted !== 'boolean') {
            return res.status(400).json({ error: "accepted (boolean) is required." });
        }

        const userId = req.user && req.user.uid ? req.user.uid : null;
        if (!userId) return res.status(401).json({ error: "Unauthorized." });

        await db.collection('user_consents').insertOne({
            userId,
            consentType,
            consentVersion,
            accepted,
            acceptedAt: new Date(),
            ipAddress: req.ip || null,
            userAgent: req.get('User-Agent') || null,
            appVersion: appVersion || null,
            deviceType: deviceType || null
        });

        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET whether the user must re-consent
router.get("/consents/required", async (req, res) => {
    const db = getDb();
    const requiredAdultTermsVersion = parseInt(process.env.ADULT_TERMS_CONSENT_VERSION || "1", 10);
    const requiredLocationServicesVersion = parseInt(process.env.LOCATION_SERVICES_CONSENT_VERSION || "1", 10);

    const userId = req.user && req.user.uid ? req.user.uid : null;
    if (!userId) return res.status(401).json({ error: "Unauthorized." });

    try {
        const latestAdult = await db.collection("user_consents").findOne(
            { userId, consentType: "adult_terms" },
            { sort: { acceptedAt: -1 } }
        );
        const latestLocation = await db.collection("user_consents").findOne(
            { userId, consentType: "location_services" },
            { sort: { acceptedAt: -1 } }
        );

        const adultRequired =
            !latestAdult ||
            latestAdult.accepted !== true ||
            latestAdult.consentVersion !== requiredAdultTermsVersion;

        const locationRequired =
            !latestLocation ||
            latestLocation.accepted !== true ||
            latestLocation.consentVersion !== requiredLocationServicesVersion;

        res.json({
            message: "success",
            data: {
                adult_terms: {
                    required: adultRequired,
                    accepted: latestAdult ? !!latestAdult.accepted : null,
                    consentVersion: latestAdult ? latestAdult.consentVersion : null,
                    requiredVersion: requiredAdultTermsVersion
                },
                location_services: {
                    required: locationRequired,
                    accepted: latestLocation ? !!latestLocation.accepted : null,
                    consentVersion: latestLocation ? latestLocation.consentVersion : null,
                    requiredVersion: requiredLocationServicesVersion
                }
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE account
router.delete("/account", async (req, res) => {
    const db = getDb();
    const userId = req.user && req.user.uid ? req.user.uid : null;
    if (!userId) return res.status(401).json({ error: "Unauthorized." });

    const anonymizedUserId = `deleted_${crypto.createHash('sha256').update(userId).digest('hex').slice(0, 16)}`;

    try {
        await db.collection("favorites").deleteMany({ userId });
        await db.collection("playlists").deleteMany({ userId });
        await db.collection("crowd_reports").updateMany(
            { userId },
            { $set: { userId: anonymizedUserId } }
        );
        await db.collection("issue_reports").updateMany(
            { userId },
            {
                $set: { userId: anonymizedUserId },
                $unset: { description: "" }
            }
        );
        await db.collection("location_verifications").updateMany(
            { userId },
            {
                $set: { userId: anonymizedUserId },
                $unset: { lat: "", lng: "" }
            }
        );
        await db.collection("support_tickets").updateMany(
            { actorUserId: userId },
            {
                $set: { actorUserId: anonymizedUserId },
                $unset: { message: "", screenshotUrl: "", resolutionReason: "" }
            }
        );

        const photoUploads = await db.collection("photo_uploads").find({ uploadedBy: userId }).toArray();
        const photoFinalUrls = photoUploads.map(p => p.finalUrl).filter(Boolean);
        const photoFinalObjectPaths = photoUploads.map(p => p.finalObjectPath).filter(Boolean);
        const photoSubmissionIds = photoUploads.map(p =>
            p._id && p._id.toHexString ? p._id.toHexString() : (p._id ? p._id.toString() : null)
        ).filter(Boolean);

        for (const objectPath of photoFinalObjectPaths) {
            try {
                await publicBucket.file(objectPath).delete();
            } catch (e) {
                // Ignore missing files
            }
        }

        if (photoFinalUrls.length > 0) {
            await db.collection("playgrounds").updateMany(
                {},
                { $pull: { imageUrls: { $in: photoFinalUrls } } }
            );
        }

        await db.collection("photo_uploads").updateMany(
            { uploadedBy: userId },
            {
                $set: { uploadedBy: anonymizedUserId },
                $unset: { finalUrl: "", finalObjectPath: "", tempObjectPath: "" }
            }
        );

        if (photoSubmissionIds.length > 0) {
            await db.collection("moderation_queue").updateMany(
                {
                    submissionType: SubmissionType.PHOTO,
                    submissionId: { $in: photoSubmissionIds }
                },
                {
                    $unset: {
                        previewUrl: "",
                        originalTempObjectPath: "",
                        sanitizedObjectPath: ""
                    }
                }
            );
        }

        await db.collection("contribution_log").deleteMany({ userId });
        await db.collection("users").deleteOne({ _id: userId });
        await db.collection("user_consents").updateMany(
            { userId },
            { $set: { userId: anonymizedUserId } }
        );

        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST toggle favorite — also keeps favoriteCount on playground in sync for badge logic
router.post("/favorites", async (req, res) => {
    const db = getDb();
    const { placeId } = req.body;
    console.log(`[favorites] toggle placeId=${placeId} userId=${req.user.uid}`);
    try {
        const existing = await db.collection("favorites").findOne({ userId: req.user.uid, placeId });
        if (existing) {
            await db.collection("favorites").deleteOne({ userId: req.user.uid, placeId });
            // Decrement favoriteCount (floor at 0)
            const filter = (() => { try { return { _id: new ObjectId(placeId) }; } catch { return { _id: placeId }; } })();
            await db.collection("playgrounds").updateOne(
                { ...filter, favoriteCount: { $gt: 0 } },
                { $inc: { favoriteCount: -1 } }
            );
            res.json({ message: "removed" });
        } else {
            await db.collection("favorites").insertOne({ userId: req.user.uid, placeId, createdAt: new Date() });
            const filter2 = (() => { try { return { _id: new ObjectId(placeId) }; } catch { return { _id: placeId }; } })();
            await db.collection("playgrounds").updateOne(
                filter2,
                { $inc: { favoriteCount: 1 } }
            );
            res.status(201).json({ message: "added" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET favorite place IDs for the authenticated user (no userId path param)
router.get("/favorites/me/ids", async (req, res) => {
    const db = getDb();
    try {
        const favs = await db.collection("favorites").find({ userId: req.user.uid }).toArray();
        res.json({ message: "success", data: favs.map(f => f.placeId) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET favorites for a user
router.get("/favorites/:userId", async (req, res) => {
    const db = getDb();
    if (req.params.userId !== req.user.uid) return res.status(403).send("Forbidden");
    try {
        const favs = await db.collection("favorites").find({ userId: req.user.uid }).toArray();
        const placeIds = favs.map(f => {
            try { return new ObjectId(f.placeId); } catch { return f.placeId; }
        });
        const places = await db.collection("playgrounds").find({ _id: { $in: placeIds } }).toArray();
        const { transformPlayground } = require('../utils/helpers');
        const transformed = places.map(p => transformPlayground(p));
        res.json({ message: "success", data: transformed });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST create list
router.post("/lists", async (req, res) => {
    const db = getDb();
    const { name, color } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 20) {
        return res.status(400).json({ error: "List name must be 1-20 characters." });
    }
    try {
        const result = await db.collection("playlists").insertOne({ name, color: color || null, userId: req.user.uid, placeIds: [], createdAt: new Date() });
        res.status(201).json({ message: "success", id: result.insertedId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET lists for the authenticated user (no userId path param — used by Kotlin client)
router.get("/lists", async (req, res) => {
    const db = getDb();
    try {
        const lists = await db.collection("playlists").find({ userId: req.user.uid }).toArray();
        const mapped = lists.map(l => ({ id: l._id, name: l.name, color: l.color || null, placeCount: (l.placeIds || []).length }));
        res.json({ message: "success", data: mapped });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET lists for a user
router.get("/lists/:userId", async (req, res) => {
    const db = getDb();
    if (req.params.userId !== req.user.uid) return res.status(403).send("Forbidden");
    try {
        const lists = await db.collection("playlists").find({ userId: req.user.uid }).toArray();
        res.json({ message: "success", data: lists });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET list detail
router.get("/lists/detail/:id", async (req, res) => {
    const db = getDb();
    try {
        const list = await db.collection("playlists").findOne({ _id: new ObjectId(req.params.id), userId: req.user.uid });
        if (!list) return res.status(404).json({ message: "List not found or not owned by user" });
        const placeIds = list.placeIds.map(id => { try { return new ObjectId(id); } catch { return id; } });
        const places = await db.collection("playgrounds").find({ _id: { $in: placeIds } }).toArray();
        const { transformPlayground } = require('../utils/helpers');
        const transformed = places.map(p => transformPlayground(p));
        res.json({ message: "success", data: { id: list._id, name: list.name, places: transformed } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT rename list
router.put("/lists/:id/rename", async (req, res) => {
    const db = getDb();
    const { name } = req.body;
    try {
        const result = await db.collection("playlists").updateOne(
            { _id: new ObjectId(req.params.id), userId: req.user.uid },
            { $set: { name } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ message: "List not found or not owned by user" });
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT add to list
router.put("/lists/:id/add", async (req, res) => {
    const db = getDb();
    const { placeId } = req.body;
    try {
        const result = await db.collection("playlists").updateOne(
            { _id: new ObjectId(req.params.id), userId: req.user.uid },
            { $addToSet: { placeIds: placeId } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ message: "List not found or not owned by user" });
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT remove from list
router.put("/lists/:id/remove", async (req, res) => {
    const db = getDb();
    const { placeId } = req.body;
    try {
        const result = await db.collection("playlists").updateOne(
            { _id: new ObjectId(req.params.id), userId: req.user.uid },
            { $pull: { placeIds: placeId } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ message: "List not found or not owned by user" });
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE list
router.delete("/lists/:id", async (req, res) => {
    const db = getDb();
    try {
        const result = await db.collection("playlists").deleteOne({ _id: new ObjectId(req.params.id), userId: req.user.uid });
        if (result.deletedCount === 0) return res.status(404).json({ message: "List not found or not owned by user" });
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/users/me/display-name — set or clear contributor display name (validated by Gemini when setting)
router.put("/users/me/display-name", async (req, res) => {
    const db = getDb();
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: "Unauthorized." });

    const { displayName, clearDisplayName } = req.body || {};
    const clearRequested =
        clearDisplayName === true ||
        displayName === null ||
        (typeof displayName === 'string' && displayName.trim() === '');

    if (clearRequested) {
        try {
            await db.collection("users").updateOne(
                { _id: userId },
                { $unset: { displayName: "" }, $set: { updatedAt: new Date() } },
                { upsert: true }
            );
            return res.json({ message: "success", displayName: null });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    if (typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 30) {
        return res.status(400).json({ error: "Display name must be 2-30 characters." });
    }

    const name = displayName.trim();

    // Gemini appropriateness check
    try {
        let ai;
        try {
            const { GoogleGenAI } = require('@google/genai');
            ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        } catch (_) { ai = null; }

        if (ai) {
            const { retryWithBackoff } = require('../services/retryWithBackoff');
            const { logGeminiCall } = require('../services/geminiCostLogger');
            const model = process.env.GEMINI_MODEL_TEXT || process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash';
            const t0 = Date.now();
            const response = await retryWithBackoff(
                () => ai.models.generateContent({
                    model,
                    contents: `Is this display name appropriate for a family-friendly kids app? Name: "${name}". Respond with JSON only: { "appropriate": true/false, "reason": "brief explanation" }`,
                }),
                { maxRetries: 2, baseDelayMs: 1500, label: 'gemini-displayname' }
            );
            const text = (response.text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(text);
            logGeminiCall({
                callSite: 'user.displayName',
                model,
                multimodal: false,
                ms: Date.now() - t0,
            });
            if (!parsed.appropriate) {
                return res.status(400).json({ error: parsed.reason || "Display name is not appropriate." });
            }
        }
    } catch (err) {
        // Fail open — if Gemini is unavailable, allow the name
        console.warn('[displayName] Gemini check failed, allowing:', err.message);
    }

    try {
        await db.collection("users").updateOne(
            { _id: userId },
            { $set: { displayName: name, updatedAt: new Date() } },
            { upsert: true }
        );
        res.json({ message: "success", displayName: name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/users/me — basic profile for role/admin check
router.get("/users/me", async (req, res) => {
    const db = getDb();
    const userId = req.user && req.user.uid ? req.user.uid : null;
    if (!userId) return res.status(401).json({ error: "Unauthorized." });
    try {
        const user = await db.collection("users").findOne({ _id: userId });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json({
            message: "success",
            data: {
                _id: user._id,
                email: user.email || null,
                role: user.role || null,
                score: user.score || 0,
                level: user.level || "New Explorer",
                adFree: user.adFree || false,
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET contributor profile — includes rank and adFree (5.4)
router.get("/users/me/contributor-profile", async (req, res) => {    const db = getDb();
    const userId = req.user && req.user.uid ? req.user.uid : null;
    if (!userId) return res.status(401).json({ error: "Unauthorized." });
    try {
        const user = await db.collection("users").findOne({ _id: userId });
        if (!user) return res.status(404).json({ message: "Profile not found" });

        // Compute rank within city leaderboard (or global if no regionKey)
        const rankQuery = user.regionKey
            ? { regionKey: user.regionKey, score: { $gt: user.score || 0 } }
            : { score: { $gt: user.score || 0 } };
        const higherCount = await db.collection("users").countDocuments(rankQuery);
        const rank = higherCount + 1;

        res.json({
            message: "success",
            data: {
                ...user,
                rank,
                adFree: user.adFree || false,
                regionKey: user.regionKey || null,
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET leaderboard — scoped by regionKey or global (5.1)
router.get("/leaderboard", async (req, res) => {
    const { regionKey, limit } = req.query;
    try {
        const leaderboard = await contributionService.getLeaderboard(regionKey || null, parseInt(limit) || 10);
        res.json({ message: "success", data: leaderboard });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET contributors leaderboard (legacy — kept for backwards compat)
router.get("/contributors/leaderboard", async (req, res) => {
    const { regionKey, city, limit } = req.query;
    try {
        const leaderboard = await contributionService.getLeaderboard(regionKey || city || null, parseInt(limit) || 10);
        res.json({ message: "success", data: leaderboard });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/users/me/notifications — unread login alerts (points awarded, rejections)
router.get("/users/me/notifications", async (req, res) => {
    const db = getDb();
    const userId = req.user && req.user.uid ? req.user.uid : null;
    if (!userId) return res.status(401).json({ error: "Unauthorized." });
    try {
        const notifications = await db.collection("user_notifications")
            .find({ userId, read: false })
            .sort({ createdAt: -1 })
            .limit(50)
            .toArray();
        res.json({ message: "success", data: notifications });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users/me/notifications/mark-read — mark all (or specific) notifications read
router.post("/users/me/notifications/mark-read", async (req, res) => {
    const db = getDb();
    const userId = req.user && req.user.uid ? req.user.uid : null;
    if (!userId) return res.status(401).json({ error: "Unauthorized." });
    const { ids } = req.body || {};
    try {
        const filter = ids && Array.isArray(ids) && ids.length > 0
            ? { userId, _id: { $in: ids.map(id => new ObjectId(id)) } }
            : { userId };
        await db.collection("user_notifications").updateMany(filter, { $set: { read: true } });
        res.json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/users/me/submissions — moderation queue rows for this user (photos, edits, new listings)
router.get('/users/me/submissions', async (req, res) => {
    const db = getDb();
    const userId = req.user && req.user.uid ? req.user.uid : null;
    if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);

    try {
        const photoRows = await db.collection('photo_uploads')
            .find({ uploadedBy: userId })
            .project({ _id: 1 })
            .toArray();
        const photoSubmissionIds = photoRows.map((p) => p._id);

        const orClauses = [
            { submittedByUserId: userId },
            { requestedBy: userId },
        ];
        if (photoSubmissionIds.length > 0) {
            orClauses.push({ submissionType: 'PHOTO', submissionId: { $in: photoSubmissionIds } });
        }

        const moderationItems = await db.collection('moderation_queue')
            .find({ $or: orClauses })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();

        const supportItems = await db.collection('support_tickets')
            .find({ actorUserId: userId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();

        const moderationRows = moderationItems.map((doc) => {
            const note = doc.reason || doc.decisionReason || null;
            const noteStr = note && String(note).trim() ? String(note).trim() : null;
            return {
                id: doc._id.toHexString(),
                source: 'MODERATION',
                submissionType: doc.submissionType,
                status: doc.status,
                playgroundName: doc.playgroundName || doc.targetName || doc.proposedNewPlayground?.name || null,
                playgroundId: doc.playgroundId ? doc.playgroundId.toString() : (doc.targetId ? String(doc.targetId) : null),
                previewUrl: doc.previewUrl || null,
                reason: noteStr,
                reviewedAt: doc.reviewedAt || null,
                createdAt: doc.createdAt,
            };
        });

        const supportRows = supportItems.map((doc) => {
            const type = String(doc.ticketType || 'other').toUpperCase();
            const displayName =
                doc.targetPlaygroundSummary?.name
                || doc.targetName
                || doc.playgroundName
                || doc.suggestionLabel
                || 'Support request';
            const note = doc.resolutionReason || doc.rejectionReason || doc.message || null;
            const noteStr = note && String(note).trim() ? String(note).trim() : null;
            return {
                id: doc._id.toHexString(),
                source: 'SUPPORT',
                submissionType: type,
                status: doc.status || 'NEEDS_ADMIN_REVIEW',
                playgroundName: displayName,
                playgroundId: doc.targetId ? String(doc.targetId) : null,
                previewUrl: doc.screenshotUrl || null,
                reason: noteStr,
                reviewedAt: doc.resolvedAt || doc.rejectedAt || null,
                createdAt: doc.createdAt,
            };
        });

        const parseCreatedAtMs = (row) => {
            if (!row || !row.createdAt) return 0;
            const ms = new Date(row.createdAt).getTime();
            return Number.isFinite(ms) ? ms : 0;
        };

        const data = moderationRows
            .concat(supportRows)
            .sort((a, b) => parseCreatedAtMs(b) - parseCreatedAtMs(a))
            .slice(0, limit);

        res.json({ message: 'success', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
