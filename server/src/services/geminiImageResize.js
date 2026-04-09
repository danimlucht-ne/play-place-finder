/**
 * Downscale images before multimodal Gemini to reduce token/image cost.
 */

let sharpWarned = false;

function getMaxEdge() {
  const n = parseInt(process.env.GEMINI_IMAGE_MAX_EDGE || '768', 10);
  return Number.isFinite(n) && n > 32 ? n : 768;
}

/**
 * @param {Buffer} buffer
 * @param {number} [maxEdge]
 * @returns {Promise<Buffer>}
 */
async function resizeForGemini(buffer, maxEdge) {
  const edge = maxEdge != null ? maxEdge : getMaxEdge();
  if (!buffer || !Buffer.isBuffer(buffer)) return buffer;

  try {
    // eslint-disable-next-line global-require
    const sharp = require('sharp');
    return await sharp(buffer)
      .resize({
        width: edge,
        height: edge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (err) {
    if (!sharpWarned) {
      sharpWarned = true;
      console.warn('[geminiImageResize] sharp failed; sending original image bytes:', err.message);
    }
    return buffer;
  }
}

module.exports = { resizeForGemini, getMaxEdge };
