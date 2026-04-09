/**
 * Structured one-line logs for attributing Gemini usage by call site.
 * Does not log prompts, images, or PII beyond optional placeId.
 * Set LOG_GEMINI_COST=0 to disable these logs.
 */

function logGeminiCall(payload) {
  if (process.env.LOG_GEMINI_COST === '0' || process.env.LOG_GEMINI_COST === 'false') {
    return;
  }

  const {
    callSite,
    model,
    multimodal = false,
    placeId,
    ms,
    batchSize,
    attempt,
  } = payload;
  const line = {
    callSite,
    model: model || null,
    multimodal,
    ms: ms != null ? Math.round(ms) : null,
  };
  if (placeId != null) line.placeId = String(placeId);
  if (batchSize != null) line.batchSize = batchSize;
  if (attempt != null) line.attempt = attempt;
  console.log('[gemini-cost]', JSON.stringify(line));
}

module.exports = { logGeminiCall };
