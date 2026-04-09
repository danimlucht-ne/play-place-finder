const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const { resolvePlaygroundIdFilter } = require('../utils/playgroundIdFilter');
const contributionService = require('./contributionService');
const { sendAdminNotificationEmail } = require('./notificationService');
const { computeBadges } = require('./badgeService');
const { computePhotoScore, mergeAndRevalidate, rerankGallery } = require('./equipmentValidationService');
const moderationStatsService = require('./moderationStatsService');

const ModerationStatus = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    AUTO_APPROVED: 'AUTO_APPROVED',
    NEEDS_ADMIN_REVIEW: 'NEEDS_ADMIN_REVIEW',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    FAILED: 'FAILED'
};

const SubmissionType = {
    PHOTO: 'PHOTO',
    PLAYGROUND_EDIT: 'PLAYGROUND_EDIT',
    NEW_PLAYGROUND: 'NEW_PLAYGROUND',
    DELETE_REQUEST: 'DELETE_REQUEST',
    REVIEW: 'REVIEW',
    ISSUE_REPORT: 'ISSUE_REPORT',
    ABUSE_TICKET: 'ABUSE_TICKET',
};

const AdminDecision = {
    APPROVE: 'APPROVE',
    REJECT: 'REJECT',
    RETRY: 'RETRY'
};

async function getQueue(status) {
    const db = getDb();
    const pipeline = [
        { $match: { status: status || ModerationStatus.NEEDS_ADMIN_REVIEW } },
        {
            $lookup: {
                from: 'photo_uploads',
                localField: 'submissionId',
                foreignField: '_id',
                as: 'submissionDetails'
            }
        },
        { $unwind: { path: '--UNWIND_MISSING_PATH--', preserveNullAndEmptyArrays: true } }, // Placeholder for dynamic unwind
        {
            $lookup: {
                from: 'playgrounds',
                localField: 'playgroundId',
                foreignField: '_id',
                as: 'playgroundDetails'
            }
        },
        { $unwind: { path: '--UNWIND_MISSING_PATH--', preserveNullAndEmptyArrays: true } }, // Placeholder for dynamic unwind
        {
            $project: {
                _id: 0,
                id: '$_id',
                submissionId: '$submissionId',
                submissionType: '$submissionType',
                playgroundName: {
                    $ifNull: [
                        '$playgroundDetails.name',
                        { $ifNull: ['$playgroundName', { $ifNull: ['$targetName', '$proposedNewPlayground.name'] }] },
                    ],
                },
                status: '$status',
                previewUrl: '$previewUrl',
                geminiSubmissionReview: '$geminiSubmissionReview',
                confidence: '$geminiSummary.confidence',
                recommendedAction: '$geminiSummary.recommendedAction',
                faceCount: '$submissionDetails.faceCount',
                moderationFlags: '$moderationFlags',
                createdAt: '$createdAt'
            }
        },
        { $sort: { createdAt: -1 } }
    ];
    
    // Dynamically adjust unwind path based on submissionType in future
    // For now, it's primarily photo uploads
    pipeline[2].$unwind.path = '$submissionDetails';
    pipeline[4].$unwind.path = '$playgroundDetails';

    return db.collection('moderation_queue').aggregate(pipeline).toArray();
}

async function getQueueItem(id) {
    const db = getDb();
    const pipeline = [
        { $match: { _id: new ObjectId(id) } },
        {
            $lookup: {
                from: 'photo_uploads',
                localField: 'submissionId',
                foreignField: '_id',
                as: 'submissionDetails'
            }
        },
        { $unwind: { path: '--UNWIND_MISSING_PATH--', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'playgrounds',
                localField: 'playgroundId',
                foreignField: '_id',
                as: 'playgroundDetails'
            }
        },
        { $unwind: { path: '--UNWIND_MISSING_PATH--', preserveNullAndEmptyArrays: true } },
        {
            $project: {
                _id: 0,
                id: '$_id',
                submissionId: '$submissionId',
                submissionType: '$submissionType',
                playgroundId: '$playgroundId',
                playgroundName: {
                    $ifNull: [
                        '$playgroundDetails.name',
                        { $ifNull: ['$playgroundName', { $ifNull: ['$targetName', '$proposedNewPlayground.name'] }] },
                    ],
                },
                status: '$status',
                previewUrl: '$previewUrl',
                geminiSummary: '$geminiSummary',
                geminiSubmissionReview: '$geminiSubmissionReview',
                proposedNewPlayground: '$proposedNewPlayground',
                moderationFlags: '$moderationFlags',
                adminDecision: '$adminDecision',
                decisionReason: '$decisionReason',
                reviewedBy: '$reviewedBy',
                reviewedAt: '$reviewedAt',
                createdAt: '$createdAt',
                moderationHistory: '$moderationHistory',
                retryCount: { $ifNull: ['$retryCount', 0] },
                photoRecord: '$submissionDetails', // Include the full photo record for detail view
                proposedChanges: '$proposedChanges',
                reason: '$reason',
                targetId: '$targetId',
                submittedByUserId: {
                    $ifNull: ['$submittedByUserId', { $ifNull: ['$submissionDetails.uploadedBy', '$requestedBy'] }],
                },
                confidence: '$geminiSummary.confidence',
                recommendedAction: '$geminiSummary.recommendedAction',
                faceCount: '$submissionDetails.faceCount',
            }
        }
    ];

    pipeline[2].$unwind.path = '$submissionDetails';
    pipeline[4].$unwind.path = '$playgroundDetails';

    const results = await db.collection('moderation_queue').aggregate(pipeline).toArray();
    return results[0];
}

async function _updateModerationRecord(queueId, updateFields, adminId, historyAction, reason = null) {
    const db = getDb();
    const queueItem = await db.collection('moderation_queue').findOne({ _id: new ObjectId(queueId) });

    if (!queueItem) throw new Error("Moderation item not found.");

    const historyEntry = {
        action: historyAction,
        previousStatus: queueItem.status,
        newStatus: updateFields.status,
        decisionReason: reason || updateFields.decisionReason || null,
        reviewedBy: adminId,
        reviewedAt: new Date()
    };

    await db.collection('moderation_queue').updateOne(
        { _id: new ObjectId(queueId) },
        { 
            $set: { ...updateFields, updatedAt: new Date() },
            $push: { moderationHistory: historyEntry },
            // Increment retryCount only if the action is 'RETRY'
            ... (historyAction === AdminDecision.RETRY && { $inc: { retryCount: 1 } })
        }
    );

    // Sync status to the underlying submission record
    const underlyingCollection = queueItem.submissionType === SubmissionType.PHOTO ? 'photo_uploads' : 'playgrounds'; // Extend for other types
    await db.collection(underlyingCollection).updateOne(
        { _id: new ObjectId(queueItem.submissionId) },
        { $set: { status: updateFields.status, reason: reason || updateFields.decisionReason || null } }
    );

    // If approved, record contribution
    if (updateFields.status === ModerationStatus.APPROVED) {
        if (queueItem.submissionType === SubmissionType.PHOTO) {
            const photoRecord = await db.collection('photo_uploads').findOne({ _id: new ObjectId(queueItem.submissionId) });
            if (photoRecord && photoRecord.uploadedBy) {
                const playground = await db.collection('playgrounds').findOne({ _id: new ObjectId(photoRecord.playgroundId) });
                await contributionService.recordContribution(photoRecord.uploadedBy, SubmissionType.PHOTO, photoRecord._id.toHexString(), playground ? playground.city : null);

                // 9.11 — recompute badges after photo approval
                if (playground) {
                    // Count approved photos for this playground
                    const approvedPhotoCount = await db.collection('photo_uploads').countDocuments({
                        playgroundId: photoRecord.playgroundId,
                        status: ModerationStatus.APPROVED
                    });
                    const updatedPlayground = { ...playground, approvedPhotoCount };
                    const newBadges = computeBadges(updatedPlayground);
                    await db.collection('playgrounds').updateOne(
                        { _id: new ObjectId(photoRecord.playgroundId) },
                        { $set: { badges: newBadges } }
                    );
                }

                // Score, merge features, and re-rank gallery for admin-approved photos
                if (photoRecord.finalUrl && photoRecord.geminiSummary) {
                    try {
                        const photoScore = computePhotoScore(photoRecord.geminiSummary, {
                            hasFaces: photoRecord.faceCount > 0,
                            isMasked: photoRecord.actionTaken === 'STICKER_MASK',
                        });
                        await db.collection('photo_scores').updateOne(
                            { playgroundId: photoRecord.playgroundId, photoUrl: photoRecord.finalUrl },
                            { $set: {
                                score: photoScore,
                                geminiSummary: photoRecord.geminiSummary,
                                detectedFeatures: photoRecord.geminiSummary.detectedFeatures || null,
                                source: 'user_upload',
                                uploadedBy: photoRecord.uploadedBy,
                                hasFaces: photoRecord.faceCount > 0,
                                isMasked: photoRecord.actionTaken === 'STICKER_MASK',
                                scoredAt: new Date(),
                            }},
                            { upsert: true },
                        );

                        const detectedFeatures = photoRecord.geminiSummary.detectedFeatures;
                        if (detectedFeatures) {
                            await mergeAndRevalidate(detectedFeatures, photoRecord.playgroundId);
                        }

                        await rerankGallery(photoRecord.playgroundId);
                    } catch (err) {
                        console.error(`[admin-approve] Post-approval scoring/validation failed for ${photoRecord.playgroundId}:`, err.message);
                    }
                }
            }
        } else if (queueItem.submissionType === SubmissionType.NEW_PLAYGROUND || queueItem.submissionType === SubmissionType.PLAYGROUND_EDIT) {
             const playground = await db.collection('playgrounds').findOne({ _id: new ObjectId(queueItem.playgroundId) });
             if (playground && playground.submittedByUserId) {
                 await contributionService.recordContribution(playground.submittedByUserId, queueItem.submissionType, queueItem.playgroundId, playground.city);
             }
        }
        // TODO: Handle contributions for other types (REVIEW, ISSUE_REPORT, etc.)
    }

    if (updateFields.status === ModerationStatus.APPROVED || updateFields.status === ModerationStatus.REJECTED) {
        const o = updateFields.status === ModerationStatus.APPROVED ? 'approved' : 'rejected';
        moderationStatsService.recordOutcomeFromQueueItem(queueItem, o).catch((err) => {
            console.error('[moderationStats] recordOutcomeFromQueueItem:', err.message);
        });
    }

    return { success: true };
}

/** User-requested removal: approve archives the playground; reject leaves it published. */
async function approveDeleteRequest(queueId, queueItem, adminId) {
    const db = getDb();
    const pid = queueItem.playgroundId ?? queueItem.targetId;
    if (pid == null || pid === '') {
        throw new Error('Invalid playground id on removal request');
    }
    const idFilter = resolvePlaygroundIdFilter(pid);
    const archiveResult = await db.collection('playgrounds').updateOne(
        { ...idFilter, archivedAt: { $exists: false } },
        { $set: { archivedAt: new Date() } },
    );
    if (archiveResult.matchedCount === 0) {
        throw new Error('Playground not found or already archived');
    }

    const updateFields = {
        status: ModerationStatus.APPROVED,
        adminDecision: AdminDecision.APPROVE,
        reviewedBy: adminId,
        reviewedAt: new Date(),
    };
    const historyEntry = {
        action: AdminDecision.APPROVE,
        previousStatus: queueItem.status,
        newStatus: ModerationStatus.APPROVED,
        decisionReason: null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
    };
    await db.collection('moderation_queue').updateOne(
        { _id: new ObjectId(queueId) },
        {
            $set: { ...updateFields, updatedAt: new Date() },
            $push: { moderationHistory: historyEntry },
        },
    );
    moderationStatsService.recordOutcomeFromQueueItem(queueItem, 'approved').catch(() => {});
    return { success: true };
}

async function rejectDeleteRequest(queueId, queueItem, adminId, reason) {
    const db = getDb();
    const updateFields = {
        status: ModerationStatus.REJECTED,
        adminDecision: AdminDecision.REJECT,
        decisionReason: reason || null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
    };
    const historyEntry = {
        action: AdminDecision.REJECT,
        previousStatus: queueItem.status,
        newStatus: ModerationStatus.REJECTED,
        decisionReason: reason || null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
    };
    await db.collection('moderation_queue').updateOne(
        { _id: new ObjectId(queueId) },
        {
            $set: { ...updateFields, updatedAt: new Date() },
            $push: { moderationHistory: historyEntry },
        },
    );
    moderationStatsService.recordOutcomeFromQueueItem(queueItem, 'rejected').catch(() => {});
    return { success: true };
}

async function approve(queueId, adminId) {
    const db = getDb();
    const queueItem = await db.collection('moderation_queue').findOne({ _id: new ObjectId(queueId) });
    if (!queueItem) throw new Error('Moderation item not found.');
    if (queueItem.submissionType === SubmissionType.DELETE_REQUEST) {
        return approveDeleteRequest(queueId, queueItem, adminId);
    }
    const updateFields = {
        status: ModerationStatus.APPROVED,
        adminDecision: AdminDecision.APPROVE,
        // decisionReason is optional for approve
    };
    return _updateModerationRecord(queueId, updateFields, adminId, AdminDecision.APPROVE);
}

async function reject(queueId, adminId, reason) {
    const db = getDb();
    const queueItem = await db.collection('moderation_queue').findOne({ _id: new ObjectId(queueId) });
    if (!queueItem) throw new Error('Moderation item not found.');
    if (queueItem.submissionType === SubmissionType.DELETE_REQUEST) {
        return rejectDeleteRequest(queueId, queueItem, adminId, reason);
    }
    const updateFields = {
        status: ModerationStatus.REJECTED,
        adminDecision: AdminDecision.REJECT,
        decisionReason: reason,
    };
    return _updateModerationRecord(queueId, updateFields, adminId, AdminDecision.REJECT, reason);
}

async function retry(queueId, adminId) {
    const updateFields = {
        status: ModerationStatus.NEEDS_ADMIN_REVIEW,
        adminDecision: AdminDecision.RETRY,
        decisionReason: `Retried by ${adminId}`,
        reviewedBy: null, // Clear review info for retry
        reviewedAt: null,
    };
    return _updateModerationRecord(queueId, updateFields, adminId, AdminDecision.RETRY);
}

module.exports = { getQueue, getQueueItem, approve, reject, retry, ModerationStatus, SubmissionType, AdminDecision };
