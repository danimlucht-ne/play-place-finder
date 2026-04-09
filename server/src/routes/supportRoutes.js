const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

const SupportTicketType = {
    QUESTION: 'question',
    COMPLAINT: 'complaint',
    REQUEST_UPDATE: 'request_update',
    REPORT_ISSUE: 'report_issue',
    OTHER: 'other'
};

const SupportTicketStatus = {
    NEEDS_ADMIN_REVIEW: 'NEEDS_ADMIN_REVIEW',
    RESOLVED: 'RESOLVED',
    REJECTED: 'REJECTED'
};

async function getConsentSnapshot(userId) {
    const db = getDb();
    const now = new Date();
    const [latestAdult, latestLocation] = await Promise.all([
        db.collection("user_consents").findOne(
            { userId, consentType: "adult_terms" },
            { sort: { acceptedAt: -1 } }
        ),
        db.collection("user_consents").findOne(
            { userId, consentType: "location_services" },
            { sort: { acceptedAt: -1 } }
        )
    ]);
    return {
        consentSnapshotAt: now,
        adultTermsConsentVersion: latestAdult ? latestAdult.consentVersion : null,
        adultTermsAccepted: latestAdult ? !!latestAdult.accepted : false,
        adultTermsAcceptedAt: latestAdult ? latestAdult.acceptedAt || null : null,
        locationServicesConsentVersion: latestLocation ? latestLocation.consentVersion : null,
        locationServicesAccepted: latestLocation ? !!latestLocation.accepted : false,
        locationServicesAcceptedAt: latestLocation ? latestLocation.acceptedAt || null : null
    };
}

// POST create support ticket
router.post("/tickets", async (req, res) => {
    const db = getDb();
    const { ticketType, category, message, targetKind, targetId, screenshotUrl } = req.body || {};

    try {
        if (!message || typeof message !== "string") {
            return res.status(400).json({ error: "message is required." });
        }

        const allowedTypes = new Set(Object.values(SupportTicketType));
        const normalizedType = allowedTypes.has(ticketType) ? ticketType : SupportTicketType.OTHER;

        const consentSnapshot = await getConsentSnapshot(req.user.uid);

        const insertResult = await db.collection("support_tickets").insertOne({
            actorUserId: req.user.uid,
            ticketType: normalizedType,
            category: category || null,
            message: message.slice(0, 2000),
            screenshotUrl: screenshotUrl || null,
            targetKind: targetKind || null,
            targetId: targetId || null,
            status: SupportTicketStatus.NEEDS_ADMIN_REVIEW,
            createdAt: new Date(),
            updatedAt: new Date(),
            resolvedAt: null,
            rejectedAt: null,
            resolvedBy: null,
            rejectedBy: null,
            resolutionReason: null,
            ...consentSnapshot
        });

        res.status(201).json({ message: "success", id: insertResult.insertedId.toHexString() });
    } catch (err) {
        console.error('[support/tickets]', req.id, req.user?.uid, err.message);
        res.status(500).json({ error: err.message, requestId: req.id });
    }
});

module.exports = router;
