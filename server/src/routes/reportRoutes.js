const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const contributionService = require('../services/contributionService');
const { getConsentSnapshot } = require('../utils/helpers');
const { ensureCanSubmit } = require('../services/authService');

const SubmissionType = {
    PHOTO: 'PHOTO',
    PLAYGROUND_EDIT: 'PLAYGROUND_EDIT',
    NEW_PLAYGROUND: 'NEW_PLAYGROUND',
    REVIEW: 'REVIEW',
    ISSUE_REPORT: 'ISSUE_REPORT',
    ABUSE_TICKET: 'ABUSE_TICKET',
    CROWD_REPORT: 'CROWD_REPORT'
};

const ReportStatus = {
    OPEN: 'open',
    CONFIRMED: 'confirmed',
    RESOLVED: 'resolved'
};

const IssueReportType = {
    BROKEN_EQUIPMENT: 'broken_equipment',
    UNSAFE_AREA: 'unsafe_area',
    TRAFFIC_RISK: 'traffic_risk',
    AGGRESSIVE_DOGS: 'aggressive_dogs',
    INCORRECT_INFO: 'incorrect_info',
    OTHER: 'other'
};

const CrowdLevel = {
    QUIET: 'Quiet',
    BUSY: 'Busy',
    PACKED: 'Packed'
};

// POST crowd report
router.post("/crowd", ensureCanSubmit, async (req, res) => {
    const db = getDb();
    const { placeId, crowdLevel } = req.body;
    try {
        const consentSnapshot = await getConsentSnapshot(req.user.uid);
        const allowedCrowd = new Set(Object.values(CrowdLevel));
        if (!allowedCrowd.has(crowdLevel)) {
            return res.status(400).json({ error: "Invalid crowdLevel." });
        }
        await db.collection("crowd_reports").insertOne({
            placeId,
            crowdLevel,
            userId: req.user.uid,
            createdAt: new Date(),
            ...consentSnapshot
        });
        await contributionService.recordContribution(req.user.uid, SubmissionType.CROWD_REPORT, placeId);
        res.status(201).json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST issue report
router.post("/issue", ensureCanSubmit, async (req, res) => {
    const db = getDb();
    const { placeId, issueType, description, affectedField } = req.body;
    try {
        const consentSnapshot = await getConsentSnapshot(req.user.uid);
        const allowedTypes = new Set(Object.values(IssueReportType));
        const normalizedType = allowedTypes.has(issueType) ? issueType : IssueReportType.OTHER;
        await db.collection("issue_reports").insertOne({
            placeId,
            reportType: normalizedType,
            legacyIssueType: issueType,
            description,
            affectedField: affectedField || null,
            userId: req.user.uid,
            status: ReportStatus.OPEN,
            createdAt: new Date(),
            ...consentSnapshot
        });
        await contributionService.recordContribution(req.user.uid, SubmissionType.ISSUE_REPORT, placeId);

        // 9.2 — decrement trust score for the affected field (floored at 0.0)
        const TRUST_DECREMENT = parseFloat(process.env.TRUST_SCORE_DECREMENT || '0.1');
        const verifiableFields = new Set([
            'hasBathrooms', 'hasShade', 'isFenced', 'hasPicnicTables', 'hasWaterFountain',
            'isToddlerFriendly', 'hasSplashPad', 'isDogFriendly', 'hasWalkingTrail', 'hasParking'
        ]);
        if (affectedField && verifiableFields.has(affectedField)) {
            const playground = await db.collection("playgrounds").findOne({ _id: placeId }, { projection: { trustScores: 1 } });
            if (playground) {
                const current = (playground.trustScores && playground.trustScores[affectedField]) ?? 0.5;
                const decrement = current - Math.max(0.0, current - TRUST_DECREMENT);
                if (decrement > 0) {
                    await db.collection("playgrounds").updateOne(
                        { _id: placeId },
                        { $inc: { [`trustScores.${affectedField}`]: -decrement } }
                    );
                }
            }
        }

        res.status(201).json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET reports for a place
router.get("/:placeId", async (req, res) => {
    const db = getDb();
    const placeId = req.params.placeId;
    try {
        const crowd = await db.collection("crowd_reports").find({ placeId }).sort({ createdAt: -1 }).limit(1).toArray();
        const issues = await db.collection("issue_reports").find({ placeId, status: ReportStatus.OPEN }).toArray();
        res.json({ message: "success", data: { latestCrowd: crowd[0] || null, activeIssues: issues } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
