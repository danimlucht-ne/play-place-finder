/**
 * equipmentValidationService.js
 *
 * Cross-references AI-detected photo features against playground records.
 * Produces validation reports, quality scores, photo hashing, dedup, and gallery ranking.
 */

const sharp = require('sharp');
const axios = require('axios');
const { getDb } = require('../database');

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalize(items) {
  return [...new Set(items.map(s => s.toLowerCase().trim()))];
}

function intersection(a, b) {
  const setB = new Set(b);
  return a.filter(x => setB.has(x));
}

function difference(a, b) {
  const setB = new Set(b);
  return a.filter(x => !setB.has(x));
}

function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// ── Amenity Map ──────────────────────────────────────────────────────────────

const amenityMap = {
  'Bathrooms': 'hasBathrooms',
  'Shade': 'hasShade',
  'Fenced': 'isFenced',
  'Picnic Tables': 'hasPicnicTables',
  'Water Fountain': 'hasWaterFountain',
  'Benches': 'hasBenches',
  'Trash Cans': 'hasTrashCans',
  'Parking': 'hasParking',
  'Walking Trail': 'hasWalkingTrail',
  'Splash Pad': 'hasSplashPad',
};

// ── Core Validation ──────────────────────────────────────────────────────────


/**
 * Compares AI-detected features against a playground record.
 * Produces a ValidationReport with confirmed, missingFromRecord, noPhotoEvidence.
 *
 * @param {Object} aggregatedDetections - merged detectedFeatures from all photos
 * @param {Object} playground - current playground document from MongoDB
 * @param {number} [photoCount] - number of photos that contributed detections
 * @returns {Object} ValidationReport
 */
function validate(aggregatedDetections, playground, photoCount = 0) {
  const report = {
    confirmed: {},
    missingFromRecord: {},
    noPhotoEvidence: {},
  };

  // Equipment
  const detectedEquip = normalize(aggregatedDetections.equipment || []);
  const recordEquip = normalize(playground.equipment || []);
  report.confirmed.equipment = intersection(detectedEquip, recordEquip).map(titleCase);
  report.missingFromRecord.equipment = difference(detectedEquip, recordEquip).map(titleCase);
  report.noPhotoEvidence.equipment = difference(recordEquip, detectedEquip).map(titleCase);

  // Swing Types
  const detectedSwings = normalize(aggregatedDetections.swingTypes || []);
  const recordSwings = normalize(playground.swingTypes || []);
  report.confirmed.swingTypes = intersection(detectedSwings, recordSwings).map(titleCase);
  report.missingFromRecord.swingTypes = difference(detectedSwings, recordSwings).map(titleCase);
  report.noPhotoEvidence.swingTypes = difference(recordSwings, detectedSwings).map(titleCase);

  // Sports Courts
  const detectedSports = normalize(aggregatedDetections.sportsCourts || []);
  const recordSports = normalize(playground.sportsCourts || []);
  report.confirmed.sportsCourts = intersection(detectedSports, recordSports).map(titleCase);
  report.missingFromRecord.sportsCourts = difference(detectedSports, recordSports).map(titleCase);
  report.noPhotoEvidence.sportsCourts = difference(recordSports, detectedSports).map(titleCase);

  // Amenities (boolean fields ↔ string detections)
  const detectedAmenities = normalize(aggregatedDetections.amenities || []);
  const recordAmenities = Object.entries(amenityMap)
    .filter(([, field]) => playground[field] === true)
    .map(([label]) => label.toLowerCase());

  report.confirmed.amenities = intersection(detectedAmenities, recordAmenities).map(titleCase);
  report.missingFromRecord.amenities = difference(detectedAmenities, recordAmenities).map(titleCase);
  report.noPhotoEvidence.amenities = difference(recordAmenities, detectedAmenities).map(titleCase);

  // Ground Surface — SKIPPED from AI validation.
  // Gemini frequently misidentifies ground type because parks have grass surrounding
  // the play area but a different surface (rubber, mulch) under the equipment.
  // Ground type is left as user-editable only.
  report.confirmed.groundSurface = null;
  report.missingFromRecord.groundSurface = null;
  report.noPhotoEvidence.groundSurface = null;

  report.dataQualityScore = computeScore(report);
  report.photoCount = photoCount;
  report.validatedAt = new Date().toISOString();

  return report;
}

// ── Score Computation ────────────────────────────────────────────────────────

function computeScore(report) {
  const categories = ['equipment', 'swingTypes', 'sportsCourts', 'amenities'];
  let confirmedCount = 0;
  let totalCount = 0;

  for (const cat of categories) {
    confirmedCount += (report.confirmed[cat] || []).length;
    totalCount += (report.confirmed[cat] || []).length
      + (report.missingFromRecord[cat] || []).length
      + (report.noPhotoEvidence[cat] || []).length;
  }

  if (report.confirmed.groundSurface) { confirmedCount++; totalCount++; }
  else if (report.missingFromRecord.groundSurface || report.noPhotoEvidence.groundSurface) { totalCount++; }

  if (totalCount === 0) return 1.0;
  return Math.round((confirmedCount / totalCount) * 100) / 100;
}

// ── Review Threshold ─────────────────────────────────────────────────────────

function shouldQueueForReview(report) {
  const SCORE_THRESHOLD = 0.5;
  const MIN_MISMATCHES = 2;

  if (report.dataQualityScore >= SCORE_THRESHOLD) return false;

  const totalMismatches =
    (report.missingFromRecord.equipment || []).length +
    (report.missingFromRecord.swingTypes || []).length +
    (report.missingFromRecord.sportsCourts || []).length +
    (report.missingFromRecord.amenities || []).length +
    (report.noPhotoEvidence.equipment || []).length +
    (report.noPhotoEvidence.swingTypes || []).length +
    (report.noPhotoEvidence.sportsCourts || []).length +
    (report.noPhotoEvidence.amenities || []).length;

  return totalMismatches >= MIN_MISMATCHES;
}


// ── Incremental Merge & Revalidate ──────────────────────────────────────────

/**
 * Merges new detections from a user-submitted photo into the playground record
 * and revalidates. Additive only — never removes existing data.
 *
 * @param {Object} newDetections - detectedFeatures from a single photo
 * @param {string} playgroundId - MongoDB _id
 * @returns {Promise<Object>} updated ValidationReport
 */
async function mergeAndRevalidate(newDetections, playgroundId) {
  const db = getDb();
  const playground = await db.collection('playgrounds').findOne({ _id: playgroundId });
  if (!playground) throw new Error(`Playground ${playgroundId} not found`);

  const mergedUpdate = {};

  // Equipment — additive union
  const detectedEquipment = newDetections.equipment || [];
  if (detectedEquipment.length > 0) {
    mergedUpdate.equipment = [...new Set([...(playground.equipment || []), ...detectedEquipment])];
  }

  // Swing types — additive union
  const detectedSwings = newDetections.swingTypes || [];
  if (detectedSwings.length > 0) {
    mergedUpdate.swingTypes = [...new Set([...(playground.swingTypes || []), ...detectedSwings])];
  }

  // Sports courts — additive union
  const detectedSports = newDetections.sportsCourts || [];
  if (detectedSports.length > 0) {
    mergedUpdate.sportsCourts = [...new Set([...(playground.sportsCourts || []), ...detectedSports])];
  }

  // Ground surface — only set if not already present
  // Coerce to string in case Gemini returned an array or object
  const rawNewGround = newDetections.groundSurface;
  const newGroundStr = typeof rawNewGround === 'string' ? rawNewGround
    : Array.isArray(rawNewGround) ? rawNewGround[0] : null;
  if (newGroundStr && !playground.groundType) {
    mergedUpdate.groundType = newGroundStr;
  }

  // Boolean amenities — only set to true, never override existing true
  for (const amenity of (newDetections.amenities || [])) {
    const field = amenityMap[amenity];
    if (field && playground[field] !== true) {
      mergedUpdate[field] = true;
    }
  }

  // Build aggregated detections from ALL approved photos
  const existingValidation = playground.photoValidation || {};
  const existingConfirmed = existingValidation.confirmed || {};
  const existingMissing = existingValidation.missingFromRecord || {};

  const allDetected = {
    equipment: [...new Set([
      ...(existingConfirmed.equipment || []),
      ...(existingMissing.equipment || []),
      ...detectedEquipment,
    ])],
    swingTypes: [...new Set([
      ...(existingConfirmed.swingTypes || []),
      ...(existingMissing.swingTypes || []),
      ...detectedSwings,
    ])],
    sportsCourts: [...new Set([
      ...(existingConfirmed.sportsCourts || []),
      ...(existingMissing.sportsCourts || []),
      ...detectedSports,
    ])],
    amenities: [...new Set([
      ...(existingConfirmed.amenities || []),
      ...(existingMissing.amenities || []),
      ...(newDetections.amenities || []),
    ])],
    groundSurface: (() => {
      const raw = newDetections.groundSurface
        || existingConfirmed.groundSurface
        || existingMissing.groundSurface
        || null;
      if (typeof raw === 'string') return raw;
      if (Array.isArray(raw)) return raw[0] || null;
      return null;
    })(),
  };

  const mergedPlayground = { ...playground, ...mergedUpdate };
  const report = validate(allDetected, mergedPlayground);
  report.photoCount = (existingValidation.photoCount || 0) + 1;

  mergedUpdate.photoValidation = report;

  if (Object.keys(mergedUpdate).length > 0) {
    await db.collection('playgrounds').updateOne(
      { _id: playgroundId },
      { $set: mergedUpdate },
    );
  }

  return report;
}


// ── Photo Quality Scoring ────────────────────────────────────────────────────

/**
 * Computes a composite quality score for a single photo.
 *
 * @param {Object|null} geminiSummary - Gemini response
 * @param {Object} options - { hasFaces, isMasked }
 * @returns {number} score in [0.0, 1.0]
 */
function computePhotoScore(geminiSummary, options = {}) {
  if (!geminiSummary || geminiSummary.aiFailed) return 0.1;
  if (!geminiSummary.photoUseful || !geminiSummary.playgroundVisible) return 0.05;

  const relevance = geminiSummary.relevanceScore || 0;
  const overview = geminiSummary.overviewScore || 0;
  const confidence = geminiSummary.confidence || 0;

  let score = relevance * 0.45 + overview * 0.35 + confidence * 0.20;

  // Face penalties
  if (options.hasFaces && !options.isMasked) score -= 0.3;
  if (options.hasFaces && options.isMasked) score -= 0.05;

  // Feature count bonus (up to +0.10)
  const features = geminiSummary.detectedFeatures || {};
  const featureCount = (features.equipment || []).length
    + (features.amenities || []).length
    + (features.sportsCourts || []).length
    + (features.swingTypes || []).length
    + (features.groundSurface ? 1 : 0);
  score += Math.min(featureCount * 0.02, 0.10);

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}


// ── Perceptual Hashing & Deduplication ───────────────────────────────────────

/**
 * Computes a perceptual hash for an image buffer.
 * Resizes to 8×8 grayscale, converts pixel brightness to 64-char binary string.
 *
 * @param {Buffer} imageBuffer
 * @returns {Promise<string>} 64-character binary string
 */
async function computePhash(imageBuffer) {
  const { data } = await sharp(imageBuffer)
    .resize(8, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Array.from(data);
  const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  return pixels.map(p => (p >= mean ? '1' : '0')).join('');
}

/**
 * Hamming distance between two pHash strings.
 * @param {string} a - 64-char binary string
 * @param {string} b - 64-char binary string
 * @returns {number} distance in [0, 64]
 */
function hammingDistance(a, b) {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}


/**
 * Deduplicates a gallery by removing near-duplicate photos.
 * Keeps the higher-scored photo from each duplicate pair.
 *
 * @param {string} playgroundId
 * @param {number} threshold - hamming distance threshold (default 10)
 * @returns {Promise<{ removed: number, pairs: Array }>}
 */
async function deduplicateGallery(playgroundId, threshold = 14) {
  const db = getDb();
  const playground = await db.collection('playgrounds').findOne({ _id: playgroundId });
  if (!playground?.imageUrls?.length) return { removed: 0, pairs: [] };

  const scoreRecords = await db.collection('photo_scores')
    .find({ playgroundId })
    .toArray();
  const scoreMap = Object.fromEntries(scoreRecords.map(r => [r.photoUrl, r]));

  // Build hash list
  const photoHashes = [];
  for (const url of playground.imageUrls) {
    const existing = scoreMap[url];
    if (existing?.phash) {
      photoHashes.push({ url, phash: existing.phash, score: existing.score || 0.5 });
      continue;
    }
    if (url.startsWith('google_photo:')) {
      photoHashes.push({ url, phash: null, score: 0.5 });
      continue;
    }
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
      const phash = await computePhash(Buffer.from(response.data, 'binary'));
      photoHashes.push({ url, phash, score: scoreMap[url]?.score || 0.5 });
      await db.collection('photo_scores').updateOne(
        { playgroundId, photoUrl: url },
        { $set: { phash } },
        { upsert: true },
      );
    } catch (_) {
      photoHashes.push({ url, phash: null, score: 0.5 });
    }
  }

  // Find duplicate pairs
  const toRemove = new Set();
  const pairs = [];

  for (let i = 0; i < photoHashes.length; i++) {
    if (!photoHashes[i].phash || toRemove.has(photoHashes[i].url)) continue;
    for (let j = i + 1; j < photoHashes.length; j++) {
      if (!photoHashes[j].phash || toRemove.has(photoHashes[j].url)) continue;
      const dist = hammingDistance(photoHashes[i].phash, photoHashes[j].phash);
      if (dist <= threshold) {
        const loser = photoHashes[i].score >= photoHashes[j].score
          ? photoHashes[j] : photoHashes[i];
        toRemove.add(loser.url);
        pairs.push({
          kept: loser === photoHashes[j] ? photoHashes[i].url : photoHashes[j].url,
          removed: loser.url,
          distance: dist,
        });
      }
    }
  }

  if (toRemove.size > 0) {
    const removeUrls = Array.from(toRemove);
    const archiveDocs = removeUrls.map(url => ({
      playgroundId,
      playgroundName: playground.name,
      regionKey: playground.regionKey,
      photoUrl: url,
      score: scoreMap[url]?.score || 0,
      archivedAt: new Date(),
      archiveReason: 'near_duplicate',
    }));
    await db.collection('archived_photos').insertMany(archiveDocs);

    const kept = playground.imageUrls.filter(u => !toRemove.has(u));
    await db.collection('playgrounds').updateOne(
      { _id: playgroundId },
      { $set: { imageUrls: kept } },
    );

    await db.collection('photo_scores').deleteMany({
      playgroundId,
      photoUrl: { $in: removeUrls },
    });
  }

  return { removed: toRemove.size, pairs };
}


// ── Gallery Re-ranking ───────────────────────────────────────────────────────

/**
 * Re-ranks all photos for a playground by descending quality score.
 * Skips DB write if order is unchanged.
 *
 * @param {string} playgroundId
 */
async function rerankGallery(playgroundId) {
  const db = getDb();
  const playground = await db.collection('playgrounds').findOne({ _id: playgroundId });
  if (!playground?.imageUrls?.length) return;

  const scoreRecords = await db.collection('photo_scores')
    .find({ playgroundId })
    .toArray();
  const scoreMap = Object.fromEntries(scoreRecords.map(r => [r.photoUrl, r.score]));

  const sorted = [...playground.imageUrls].sort((a, b) => {
    return (scoreMap[b] || 0.5) - (scoreMap[a] || 0.5);
  });

  if (sorted.join('||') !== playground.imageUrls.join('||')) {
    await db.collection('playgrounds').updateOne(
      { _id: playgroundId },
      { $set: { imageUrls: sorted } },
    );
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Helpers (exported for testing)
  normalize,
  intersection,
  difference,
  titleCase,
  amenityMap,
  // Core
  validate,
  computeScore,
  shouldQueueForReview,
  mergeAndRevalidate,
  // Photo scoring
  computePhotoScore,
  // Hashing & dedup
  computePhash,
  hammingDistance,
  deduplicateGallery,
  // Gallery
  rerankGallery,
};
