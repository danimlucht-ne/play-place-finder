const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { buildTargetPlaygroundSummary, parseFeatureSuggestionMessage } = require('../services/suggestionApprovalService');

const SupportTicketType = {
    QUESTION: 'question',
    COMPLAINT: 'complaint',
    REQUEST_UPDATE: 'request_update',
    REPORT_ISSUE: 'report_issue',
    /** Playground edit flow: new amenity / equipment / ground option labels (app sends SUGGESTION). */
    SUGGESTION: 'suggestion',
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
    const {
        ticketType,
        category,
        message,
        targetKind,
        targetId,
        screenshotUrl,
        suggestionCategory,
        suggestionLabel,
    } = req.body || {};

    try {
        const rawTypeEarly = typeof ticketType === 'string' ? ticketType.trim() : '';
        const mappedEarly = rawTypeEarly ? {
            GENERAL: 'question',
            CONTENT_ISSUE: 'report_issue',
            AD_INQUIRY: 'request_update',
            ACCOUNT: 'complaint',
            BUG: 'complaint',
            SUGGESTION: 'suggestion',
        }[rawTypeEarly.toUpperCase()] : undefined;
        const isSuggestionTicket = mappedEarly === 'suggestion'
            || String(ticketType || '').toLowerCase() === 'suggestion';

        let labelTrim = typeof suggestionLabel === 'string' ? suggestionLabel.trim() : '';
        let catTrim = typeof suggestionCategory === 'string' ? suggestionCategory.trim() : '';
        const messageOk = message && typeof message === 'string' && message.trim().length > 0;
        if (isSuggestionTicket && messageOk && (!catTrim || !labelTrim)) {
            const parsed = parseFeatureSuggestionMessage(message);
            if (!catTrim && parsed.category) catTrim = parsed.category;
            if (!labelTrim && parsed.label) labelTrim = parsed.label;
        }
        if (!messageOk && !(isSuggestionTicket && labelTrim && catTrim)) {
            return res.status(400).json({ error: "message is required (or suggestionCategory + suggestionLabel for suggestions)." });
        }

        const allowedTypes = new Set(Object.values(SupportTicketType));
        /** App sends UPPER_SNAKE names; normalize to stored enum values for admin triage. */
        const clientTypeMap = {
            GENERAL: SupportTicketType.QUESTION,
            CONTENT_ISSUE: SupportTicketType.REPORT_ISSUE,
            AD_INQUIRY: SupportTicketType.REQUEST_UPDATE,
            ACCOUNT: SupportTicketType.COMPLAINT,
            BUG: SupportTicketType.COMPLAINT,
            SUGGESTION: SupportTicketType.SUGGESTION,
        };
        const rawType = typeof ticketType === 'string' ? ticketType.trim() : '';
        const lowerType = rawType.toLowerCase();
        const mappedFromClient = rawType ? clientTypeMap[rawType.toUpperCase()] : undefined;
        const normalizedType = allowedTypes.has(lowerType)
            ? lowerType
            : (mappedFromClient || SupportTicketType.OTHER);

        const consentSnapshot = await getConsentSnapshot(req.user.uid);

        const safeMessage = messageOk
            ? String(message).trim().slice(0, 2000)
            : `New ${catTrim} suggestion: ${labelTrim}`.slice(0, 2000);

        let targetPlaygroundSummary = null;
        if (normalizedType === SupportTicketType.SUGGESTION && targetKind && targetId) {
            try {
                targetPlaygroundSummary = await buildTargetPlaygroundSummary(db, targetKind, targetId);
            } catch (_) {
                targetPlaygroundSummary = null;
            }
        }

        const insertResult = await db.collection("support_tickets").insertOne({
            actorUserId: req.user.uid,
            ticketType: normalizedType,
            category: category || null,
            message: safeMessage,
            screenshotUrl: screenshotUrl || null,
            targetKind: targetKind || null,
            targetId: targetId || null,
            suggestionCategory: normalizedType === SupportTicketType.SUGGESTION && catTrim ? catTrim : null,
            suggestionLabel: normalizedType === SupportTicketType.SUGGESTION && labelTrim ? labelTrim : null,
            targetPlaygroundSummary,
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
