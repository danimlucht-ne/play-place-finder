const sharp = require('sharp');

const ALLOWED_IMAGE_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const MIME_BY_SHARP_FORMAT = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
});

/** Max for `/api/upload-image` (multer should enforce the same cap). */
const MAX_USER_UPLOAD_IMAGE_BYTES = 10 * 1024 * 1024;

/** Ad creative uploads use a smaller cap in adSubmissionRoutes. */
const MAX_AD_ASSET_IMAGE_BYTES = 2 * 1024 * 1024;

function allowedMimeSet() {
  return new Set(ALLOWED_IMAGE_TYPES);
}

/**
 * Ensures buffer is a real image of an allowed type and matches declared MIME.
 * @param {Buffer} buffer
 * @param {string} [declaredMimeType] — from multer; if set, must match magic-byte type
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<{ contentType: string, width?: number, height?: number }>}
 */
async function assertValidImageBuffer(buffer, declaredMimeType, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_USER_UPLOAD_IMAGE_BYTES;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error('Invalid image file.');
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > maxBytes) {
    const err = new Error(`Image must not exceed ${Math.round(maxBytes / (1024 * 1024))}MB.`);
    err.statusCode = 400;
    throw err;
  }

  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch (_) {
    const err = new Error('Invalid or corrupted image file.');
    err.statusCode = 400;
    throw err;
  }

  const fmt = meta.format;
  const contentType = fmt ? MIME_BY_SHARP_FORMAT[fmt] : null;
  if (!contentType || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
    const err = new Error(
      `Unsupported image type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`,
    );
    err.statusCode = 400;
    throw err;
  }

  if (declaredMimeType && String(declaredMimeType).trim() !== contentType) {
    const err = new Error('Image Content-Type does not match file contents.');
    err.statusCode = 400;
    throw err;
  }

  return { contentType, width: meta.width, height: meta.height };
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  MAX_USER_UPLOAD_IMAGE_BYTES,
  MAX_AD_ASSET_IMAGE_BYTES,
  allowedMimeSet,
  assertValidImageBuffer,
};
