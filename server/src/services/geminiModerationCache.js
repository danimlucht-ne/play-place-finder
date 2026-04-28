const crypto = require('crypto');

const TEXT_REVIEW_COLLECTION = 'gemini_text_review_cache';
const IMAGE_REVIEW_COLLECTION = 'gemini_image_review_cache';
const PHOTO_SUMMARY_COLLECTION = 'gemini_photo_summary_cache';
const DESCRIPTION_COLLECTION = 'gemini_description_cache';

function safeGetDb() {
  try {
    const { getDb } = require('../database');
    return typeof getDb === 'function' ? getDb() : null;
  } catch (_) {
    return null;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeName(value) {
  return normalizeText(value).replace(/[^a-z0-9 ]+/g, '');
}

function buildTextReviewKey(textBundle) {
  return sha256(normalizeText(textBundle));
}

function buildImageReviewKey(imageBuffer, placeName = '') {
  return sha256(
    Buffer.concat([
      Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(String(imageBuffer || '')),
      Buffer.from(`|place:${normalizeName(placeName)}`, 'utf8'),
    ]),
  );
}

function buildPhotoSummaryKey(imageBuffer, contextKey) {
  return sha256(
    Buffer.concat([
      Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(String(imageBuffer || '')),
      Buffer.from(`|context:${String(contextKey || '')}`, 'utf8'),
    ]),
  );
}

function buildDescriptionKey(placeName, placeTypes = [], editorialSummary = '', heroImageBuffer = null) {
  const typeKey = Array.isArray(placeTypes) ? placeTypes.map((t) => String(t).toLowerCase()).sort().join(',') : '';
  const summaryKey = normalizeText(editorialSummary);
  const nameKey = normalizeName(placeName);
  if (heroImageBuffer && Buffer.isBuffer(heroImageBuffer)) {
    return sha256(
      Buffer.concat([
        heroImageBuffer,
        Buffer.from(`|name:${nameKey}|types:${typeKey}|summary:${summaryKey}`, 'utf8'),
      ]),
    );
  }
  return sha256(`name:${nameKey}|types:${typeKey}|summary:${summaryKey}`);
}

async function getCachedRecord(collectionName, key) {
  const db = safeGetDb();
  if (!db) return null;
  try {
    const doc = await db.collection(collectionName).findOne({ _id: key });
    return doc ? doc.payload || null : null;
  } catch (_) {
    return null;
  }
}

async function setCachedRecord(collectionName, key, payload, meta = {}) {
  const db = safeGetDb();
  if (!db || !payload) return;
  try {
    await db.collection(collectionName).updateOne(
      { _id: key },
      {
        $set: {
          payload,
          updatedAt: new Date(),
          meta,
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (_) {
    // Cache misses should never break request flow.
  }
}

module.exports = {
  TEXT_REVIEW_COLLECTION,
  IMAGE_REVIEW_COLLECTION,
  PHOTO_SUMMARY_COLLECTION,
  DESCRIPTION_COLLECTION,
  normalizeText,
  normalizeName,
  buildTextReviewKey,
  buildImageReviewKey,
  buildPhotoSummaryKey,
  buildDescriptionKey,
  getCachedRecord,
  setCachedRecord,
};
