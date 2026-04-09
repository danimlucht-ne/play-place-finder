const { ObjectId } = require('mongodb');
const { Storage } = require('@google-cloud/storage');
const { getDb } = require('../database');
const { moderatePhoto } = require('./photoModerationService');
const { deleteFromQuarantine } = require('./photoCleanupService');
const contributionService = require('./contributionService');
const { sendAdminNotificationEmail } = require('./notificationService');
const { computePhotoScore, mergeAndRevalidate, rerankGallery } = require('./equipmentValidationService');

const publicBucketName = "playground_app_bucket";
const quarantineBucketName = "playground_app_bucket"; // same bucket, quarantine/ prefix used for paths

const storage = new Storage(); // Assumes project ID and keyfile from env/default
const publicBucket = storage.bucket(publicBucketName);
const quarantineBucket = storage.bucket(quarantineBucketName);

// --- ENUMS (Duplicated for clarity in service) ---
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
    REVIEW: 'REVIEW',
    ISSUE_REPORT: 'ISSUE_REPORT',
    ABUSE_TICKET: 'ABUSE_TICKET'
};
// --------------------------------------------------

async function initPhotoUpload(filename, contentType, consentSnapshot = {}) {
    const db = getDb();
    // Create a new ObjectId for the photo record immediately
    const newPhotoId = new ObjectId();
    const fileId = `quarantine/original-${newPhotoId.toHexString()}-${Date.now()}-${filename}`;

    // Create a temporary photo upload record in PENDING state
    const tempPhotoRecord = {
        _id: newPhotoId,
        playgroundId: null, // Will be linked in processPhoto
        uploadedBy: null, // Will be linked in processPhoto
        status: ModerationStatus.PENDING,
        tempObjectPath: fileId,
        createdAt: new Date(),
        quarantineExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Original expires in 24 hours
        ...consentSnapshot
    };
    await db.collection('photo_uploads').insertOne(tempPhotoRecord);

    const file = quarantineBucket.file(fileId);
    const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // 15 mins for upload
        contentType: contentType || 'image/jpeg'
    });
    return { uploadUrl: url, fileId: file.name, photoRecordId: newPhotoId.toHexString() };
}

async function processPhoto(photoRecordId, playgroundId, uploadedByUserId) {
    const db = getDb();
    const photoRecordObjectId = new ObjectId(photoRecordId);
    const photoRecord = await db.collection('photo_uploads').findOne({ _id: photoRecordObjectId });

    if (!photoRecord) throw new Error(`Photo record ${photoRecordId} not found.`);
    if (!photoRecord.tempObjectPath) throw new Error(`Temporary object path missing for ${photoRecordId}.`);

    const originalFileId = photoRecord.tempObjectPath;
    const fileInQuarantine = quarantineBucket.file(originalFileId);

    // Update photo record status to PROCESSING
    await db.collection('photo_uploads').updateOne(
        { _id: photoRecordObjectId },
        { $set: { status: ModerationStatus.PROCESSING, playgroundId, uploadedBy: uploadedByUserId } }
    );

    let content; // Original image buffer
    try {
        [content] = await fileInQuarantine.download();
    } catch (error) {
        console.error(`Error downloading original photo ${originalFileId} from quarantine:`, error.message);
        await db.collection('photo_uploads').updateOne({ _id: photoRecordObjectId }, { $set: { status: ModerationStatus.FAILED, reason: 'Failed to download original.', processedAt: new Date() } });
        throw new Error("Failed to download original image for processing.");
    }

    // Perform moderation — look up playground for location context
    const playgroundRecord = await db.collection('playgrounds').findOne({ _id: playgroundId });
    const moderationResult = await moderatePhoto(
        content,
        playgroundRecord?.types || [],
        playgroundRecord?.name || '',
    );

    let finalUrl = null;
    let finalObjectPath = null;

    if (moderationResult.status === ModerationStatus.AUTO_APPROVED || moderationResult.status === ModerationStatus.NEEDS_ADMIN_REVIEW) {
        // Save to public bucket
        const publicFileName = `public-${photoRecordObjectId.toHexString()}.jpeg`; // Standardize public name
        const finalFile = publicBucket.file(publicFileName);
        try {
            await finalFile.save(moderationResult.processedBuffer, { contentType: 'image/jpeg' });
            finalUrl = `https://storage.googleapis.com/${publicBucket.name}/${finalFile.name}`;
            finalObjectPath = finalFile.name;
        } catch (error) {
            console.error(`Error saving processed photo ${publicFileName} to public bucket:`, error.message);
            moderationResult.status = ModerationStatus.FAILED; // Mark as failed if public save fails
            moderationResult.reason = 'Failed to save processed image to public storage.';
        }
    }

    // Update the final photo record with moderation results
    const updatePhotoFields = {
        status: moderationResult.status,
        finalObjectPath: finalObjectPath,
        finalUrl: finalUrl,
        peopleDetected: moderationResult.peopleDetected,
        faceCount: moderationResult.faceCount,
        actionTaken: moderationResult.actionTaken,
        reason: moderationResult.reason,
        geminiSummary: moderationResult.geminiSummary,
        processedAt: new Date(),
        quarantineExpiresAt: null, // Clear TTL as original is handled
    };
    await db.collection('photo_uploads').updateOne({ _id: photoRecordObjectId }, { $set: updatePhotoFields });

    // Delete original from quarantine regardless of outcome
    await deleteFromQuarantine(originalFileId);

    // Handle moderation queue and notifications
    if (moderationResult.status === ModerationStatus.NEEDS_ADMIN_REVIEW) {
        const playground = await db.collection('playgrounds').findOne({ _id: new ObjectId(playgroundId) });
        const queueRecord = {
            submissionId: photoRecordId,
            submissionType: SubmissionType.PHOTO,
            playgroundId: playgroundId,
            playgroundName: playground ? playground.name : 'Unknown Play Place',
            status: ModerationStatus.NEEDS_ADMIN_REVIEW,
            priority: 'normal',
            previewUrl: finalUrl, // Preview is the masked URL if available
            originalTempObjectPath: originalFileId,
            sanitizedObjectPath: finalObjectPath,
            geminiSummary: moderationResult.geminiSummary,
            moderationFlags: moderationResult.moderationFlags,
            // Consent snapshot for liability/audit: which consent versions applied at upload time.
            consentSnapshotAt: photoRecord.consentSnapshotAt || null,
            adultTermsConsentVersion: photoRecord.adultTermsConsentVersion || null,
            adultTermsAccepted: photoRecord.adultTermsAccepted || false,
            adultTermsAcceptedAt: photoRecord.adultTermsAcceptedAt || null,
            locationServicesConsentVersion: photoRecord.locationServicesConsentVersion || null,
            locationServicesAccepted: photoRecord.locationServicesAccepted || false,
            locationServicesAcceptedAt: photoRecord.locationServicesAcceptedAt || null,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await db.collection('moderation_queue').insertOne(queueRecord);
        // Send notification to admin
        const emailSubject = `New Photo for Moderation: ${playground ? playground.name : 'Unknown'}`;
        const emailBody = `A new photo for Play Place ID ${playgroundId} (${playground ? playground.name : 'Unknown'}) requires your review.
Status: ${moderationResult.status}.
Reason: ${moderationResult.reason || 'N/A'}.
Preview: ${finalUrl || 'N/A'}`; // Link to preview if available
        sendAdminNotificationEmail(emailSubject, emailBody, `<b>${emailSubject}</b><p>${emailBody.replace(/\n/g, '<br>')}</p>`);
    }

    // Record contribution if photo is AUTO_APPROVED (Admin Approved contributions are handled in adminModerationService)
    if (moderationResult.status === ModerationStatus.AUTO_APPROVED && uploadedByUserId) {
        const playground = await db.collection('playgrounds').findOne({ _id: new ObjectId(playgroundId) });
        await contributionService.recordContribution(uploadedByUserId, SubmissionType.PHOTO, photoRecordObjectId.toHexString(), playground ? playground.city : null);
    }

    // Score, merge features, and re-rank gallery for approved photos
    if (moderationResult.status === ModerationStatus.AUTO_APPROVED && finalUrl && moderationResult.geminiSummary) {
        try {
            const photoScore = computePhotoScore(moderationResult.geminiSummary, {
                hasFaces: moderationResult.faceCount > 0,
                isMasked: moderationResult.actionTaken === 'STICKER_MASK',
            });
            await db.collection('photo_scores').updateOne(
                { playgroundId, photoUrl: finalUrl },
                { $set: {
                    score: photoScore,
                    geminiSummary: moderationResult.geminiSummary,
                    detectedFeatures: moderationResult.geminiSummary.detectedFeatures || null,
                    source: 'user_upload',
                    uploadedBy: uploadedByUserId,
                    hasFaces: moderationResult.faceCount > 0,
                    isMasked: moderationResult.actionTaken === 'STICKER_MASK',
                    scoredAt: new Date(),
                }},
                { upsert: true },
            );

            const detectedFeatures = moderationResult.geminiSummary.detectedFeatures;
            if (detectedFeatures) {
                await mergeAndRevalidate(detectedFeatures, playgroundId);
            }

            await rerankGallery(playgroundId);
        } catch (err) {
            console.error(`[processPhoto] Post-approval scoring/validation failed for ${playgroundId}:`, err.message);
        }
    }

    return { status: moderationResult.status, url: finalUrl, reason: moderationResult.reason };
}

module.exports = { initPhotoUpload, processPhoto };
