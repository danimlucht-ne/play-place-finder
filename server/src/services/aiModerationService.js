/**
 * AI Moderation Service (Phase 18)
 *
 * Responsibilities:
 *  - reviewPhoto(imageUrl)  → { approved, reason, hasFaces, onlyFaces }
 *  - reviewEdit(fields)     → { approved, reason }
 *  - blurFaces(imageUrl)    → sanitizedUrl (GCS path with faces blurred/stickered)
 *
 * Currently uses Google Cloud Vision API for content safety + face detection.
 * Falls back to "approved" if the API is unavailable so the app keeps working.
 */

const vision = (() => {
    try {
        return require('@google-cloud/vision');
    } catch {
        return null;
    }
})();

const { publicBucket } = require('./storageService');

// Likelihood thresholds — VERY_LIKELY or LIKELY triggers rejection
const UNSAFE_LIKELIHOODS = new Set(['VERY_LIKELY', 'LIKELY']);

/**
 * Review a photo for inappropriate content and face detection.
 * @param {string} imageUrl  Public GCS URL of the image
 * @returns {{ approved: boolean, reason: string|null, hasFaces: boolean, onlyFaces: boolean }}
 */
async function reviewPhoto(imageUrl) {
    if (!vision) {
        console.warn('[aiModeration] @google-cloud/vision not installed — skipping photo review');
        return { approved: true, reason: null, hasFaces: false, onlyFaces: false };
    }

    try {
        const client = new vision.ImageAnnotatorClient();
        const [result] = await client.annotateImage({
            image: { source: { imageUri: imageUrl } },
            features: [
                { type: 'SAFE_SEARCH_DETECTION' },
                { type: 'FACE_DETECTION', maxResults: 10 },
            ],
        });

        // Safe-search check
        const safe = result.safeSearchAnnotation || {};
        const isUnsafe =
            UNSAFE_LIKELIHOODS.has(safe.adult) ||
            UNSAFE_LIKELIHOODS.has(safe.violence) ||
            UNSAFE_LIKELIHOODS.has(safe.racy);

        if (isUnsafe) {
            return {
                approved: false,
                reason: `Inappropriate content detected (adult=${safe.adult}, violence=${safe.violence}, racy=${safe.racy})`,
                hasFaces: false,
                onlyFaces: false,
            };
        }

        // Face detection
        const faces = result.faceAnnotations || [];
        const hasFaces = faces.length > 0;

        // Heuristic: if all detected objects are faces (no other labels), treat as face-only
        const [labelResult] = await client.labelDetection({ image: { source: { imageUri: imageUrl } } });
        const labels = (labelResult.labelAnnotations || []).map(l => l.description.toLowerCase());
        const nonFaceLabels = labels.filter(l => !['face', 'person', 'head', 'selfie', 'nose', 'chin', 'forehead'].includes(l));
        const onlyFaces = hasFaces && nonFaceLabels.length === 0;

        if (onlyFaces) {
            return {
                approved: false,
                reason: 'Photo appears to contain only faces. Please submit photos of the play place itself.',
                hasFaces: true,
                onlyFaces: true,
            };
        }

        return { approved: true, reason: null, hasFaces, onlyFaces: false };
    } catch (err) {
        console.error('[aiModeration] reviewPhoto error:', err.message);
        // Fail open — don't block submissions if Vision API is down
        return { approved: true, reason: null, hasFaces: false, onlyFaces: false };
    }
}

/**
 * Review a playground edit for inappropriate text content.
 * @param {object} fields  Key/value pairs of the edited fields
 * @returns {{ approved: boolean, reason: string|null }}
 */
async function reviewEdit(fields) {
    if (!vision) {
        return { approved: true, reason: null };
    }

    // Collect all string values to check
    const textToCheck = Object.values(fields)
        .filter(v => typeof v === 'string')
        .join('\n');

    if (!textToCheck.trim()) return { approved: true, reason: null };

    try {
        const client = new vision.ImageAnnotatorClient();
        // Use Natural Language API for text moderation if available, otherwise skip
        // For now we do a simple profanity/spam heuristic via keyword list
        const blockedPatterns = [
            /\b(spam|scam|fake|phishing)\b/i,
            /https?:\/\//i,  // no URLs in text fields
        ];
        for (const pattern of blockedPatterns) {
            if (pattern.test(textToCheck)) {
                return { approved: false, reason: `Edit contains disallowed content (matched: ${pattern.source})` };
            }
        }
        return { approved: true, reason: null };
    } catch (err) {
        console.error('[aiModeration] reviewEdit error:', err.message);
        return { approved: true, reason: null };
    }
}

/**
 * Blur/sticker faces in an image and save to a new GCS path.
 * Returns the sanitized public URL, or the original URL if blurring fails.
 * @param {string} objectPath  GCS object path (not full URL)
 * @returns {Promise<string>}  Public URL of the sanitized image
 */
async function blurFaces(objectPath) {
    let faceStickerMask;
    try {
        faceStickerMask = require('./faceStickerMaskService');
    } catch {
        console.warn('[aiModeration] faceStickerMaskService not available');
        const file = publicBucket.file(objectPath);
        const [metadata] = await file.getMetadata().catch(() => [{}]);
        return metadata.mediaLink || `https://storage.googleapis.com/${publicBucket.name}/${objectPath}`;
    }

    try {
        // Download original image
        const file = publicBucket.file(objectPath);
        const [imageBuffer] = await file.download();

        // Detect faces
        const faces = await faceStickerMask.detectFaces(imageBuffer);
        if (faces.length === 0) {
            // No faces — return original URL
            const [metadata] = await file.getMetadata().catch(() => [{}]);
            return metadata.mediaLink || `https://storage.googleapis.com/${publicBucket.name}/${objectPath}`;
        }

        // Apply sticker masks
        const processedBuffer = await faceStickerMask.applyStickerMasks(imageBuffer, faces);

        // Upload to a new path with "-masked" suffix
        const ext = objectPath.includes('.') ? objectPath.substring(objectPath.lastIndexOf('.')) : '.jpg';
        const basePath = objectPath.includes('.') ? objectPath.substring(0, objectPath.lastIndexOf('.')) : objectPath;
        const maskedPath = `${basePath}-masked${ext}`;

        const maskedFile = publicBucket.file(maskedPath);
        await maskedFile.save(processedBuffer, {
            metadata: { contentType: 'image/jpeg' },
        });

        return `https://storage.googleapis.com/${publicBucket.name}/${maskedPath}`;
    } catch (err) {
        console.error('[aiModeration] blurFaces error:', err.message);
        // Fail open — return original URL
        const file = publicBucket.file(objectPath);
        const [metadata] = await file.getMetadata().catch(() => [{}]);
        return metadata.mediaLink || `https://storage.googleapis.com/${publicBucket.name}/${objectPath}`;
    }
}

module.exports = { reviewPhoto, reviewEdit, blurFaces };
