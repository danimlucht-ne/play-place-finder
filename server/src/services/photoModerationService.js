const sharp = require('sharp');
const config = require('./photoModerationConfig');
const { detectFaces, applyStickerMasks } = require('./faceStickerMaskService');
const { getGeminiSummary } = require('./photoClassificationService');

async function moderatePhoto(imageBuffer, placeTypes = [], placeName = '') {
    const moderationResult = {
        status: 'PENDING', // Initial status
        faceCount: 0,
        peopleDetected: false,
        actionTaken: 'NONE',
        reason: null,
        processedBuffer: imageBuffer, // Stays original if no changes
        geminiSummary: null,
        moderationFlags: [],
    };

    // 1. Face Detection
    let faces;
    try {
        faces = await detectFaces(imageBuffer);
        moderationResult.faceCount = faces.length;
        moderationResult.peopleDetected = faces.length > 0; // Simple heuristic for now
    } catch (error) {
        console.error("Cloud Vision face detection failed:", error);
        moderationResult.status = 'FAILED';
        moderationResult.reason = 'Face detection service failed.';
        return moderationResult;
    }

    // 2. Threshold Checks based on Face Detection
    if (faces.length > config.MAX_FACES) {
        moderationResult.status = 'REJECTED';
        moderationResult.actionTaken = 'REJECT';
        moderationResult.reason = `Too many faces detected (${faces.length} > ${config.MAX_FACES}).`;
        moderationResult.moderationFlags.push('TOO_MANY_FACES');
        return moderationResult;
    }

    if (faces.length > 0) {
        let imageMetadata;
        try {
            imageMetadata = await sharp(imageBuffer).metadata();
        } catch (error) {
            console.error("Sharp metadata extraction failed:", error);
            moderationResult.status = 'FAILED';
            moderationResult.reason = 'Image processing failed during metadata extraction.';
            return moderationResult;
        }
        const imageArea = imageMetadata.width * imageMetadata.height;

        const largestFaceArea = faces.reduce((max, face) => {
            const box = face.boundingPoly.vertices;
            const faceWidth = Math.abs(box[1].x - box[0].x);
            const faceHeight = Math.abs(box[2].y - box[1].y);
            return Math.max(max, faceWidth * faceHeight);
        }, 0);

        const largestFaceAreaRatio = largestFaceArea / imageArea;
        if (largestFaceAreaRatio > config.MAX_FACE_AREA_RATIO) {
            moderationResult.status = 'REJECTED';
            moderationResult.actionTaken = 'REJECT';
            moderationResult.reason = `Face is too prominent (occupies ${Math.round(largestFaceAreaRatio * 100)}% of image).`;
            moderationResult.moderationFlags.push('PROMINENT_FACE');
            return moderationResult;
        }
    }

    // 3. Gemini Usefulness Classification
    let geminiSummary;
    try {
        geminiSummary = await getGeminiSummary(imageBuffer, faces.length, placeTypes, placeName); // Pass actual faceCount + location context to Gemini
        moderationResult.geminiSummary = geminiSummary;
        moderationResult.peopleDetected = geminiSummary.peopleDetected || moderationResult.peopleDetected; // Update based on Gemini too
    } catch (error) {
        console.error("Gemini classification failed:", error);
        moderationResult.status = 'FAILED';
        moderationResult.reason = 'AI classification service failed.';
        return moderationResult;
    }

    if (geminiSummary.recommendedAction === 'REJECT') {
        moderationResult.status = 'REJECTED';
        moderationResult.actionTaken = 'REJECT';
        moderationResult.reason = geminiSummary.notes || 'Rejected by AI classification.';
        moderationResult.moderationFlags.push('AI_REJECTED_USEFULNESS');
        return moderationResult;
    }

    // 4. Sticker Masking (if faces passed initial checks)
    if (faces.length > 0) {
        try {
            moderationResult.processedBuffer = await applyStickerMasks(imageBuffer, faces);
            moderationResult.actionTaken = 'STICKER_MASK';
            moderationResult.moderationFlags.push('STICKER_MASK_APPLIED');
        } catch (error) {
            console.error("Sticker masking failed:", error);
            moderationResult.status = 'FAILED';
            moderationResult.reason = 'Sticker masking failed.';
            return moderationResult;
        }
    }

    // 5. Final Decision based on all checks
    if (faces.length > 0) {
        // If faces were detected and sticker-masked, auto-approve if Gemini confidence is > 60%
        // (the stickers adequately protect privacy, and the AI is confident the photo is useful)
        const confidence = geminiSummary.confidence || 0;
        if (moderationResult.actionTaken === 'STICKER_MASK' && confidence > 0.6) {
            moderationResult.status = 'AUTO_APPROVED';
            moderationResult.moderationFlags.push('STICKER_MASK_AUTO_APPROVED');
        } else {
            moderationResult.status = 'NEEDS_ADMIN_REVIEW';
            moderationResult.moderationFlags.push('NEEDS_ADMIN_REVIEW');
        }
    } else if (geminiSummary.recommendedAction === 'AUTO_APPROVE') {
        moderationResult.status = 'AUTO_APPROVED';
    } else {
        // Fallback, should ideally be covered by recommendedAction
        moderationResult.status = 'NEEDS_ADMIN_REVIEW'; 
        moderationResult.moderationFlags.push('UNCLASSIFIED_NEEDS_REVIEW');
    }

    return moderationResult;
}

module.exports = { moderatePhoto };
