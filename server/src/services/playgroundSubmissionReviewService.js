/**
 * Gemini review for user-submitted playground text + optional user-uploaded images (HTTPS URLs).
 * Used to auto-approve live saves when content looks safe; otherwise callers queue for admin.
 */
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const {
  buildImageReviewKey,
  buildTextReviewKey,
  getCachedRecord,
  normalizeText,
  setCachedRecord,
  IMAGE_REVIEW_COLLECTION,
  TEXT_REVIEW_COLLECTION,
} = require('./geminiModerationCache');

let ai;
try {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} catch (e) {
  console.error('[playgroundSubmissionReview] GoogleGenAI init failed:', e.message);
  ai = null;
}

function getMinConfidence() {
  return parseFloat(process.env.PLAYGROUND_REVIEW_MIN_AUTO_CONFIDENCE || '0.82');
}

function getMaxImages() {
  return parseInt(process.env.PLAYGROUND_REVIEW_MAX_IMAGES || '3', 10);
}

function getTextModel() {
  return process.env.GEMINI_MODEL_TEXT || process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash';
}

function getMultimodalModel() {
  return process.env.GEMINI_MODEL_MULTIMODAL || process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash';
}

function automatedReviewFailureConcern(scope, err) {
  const message = String(err?.message || '').trim();
  const normalized = message.toLowerCase();
  const disabledOrUnavailable =
    normalized.includes('generativelanguage.googleapis.com') ||
    normalized.includes('permission_denied') ||
    normalized.includes('service_disabled') ||
    normalized.includes('api has not been used') ||
    normalized.includes('api key not valid') ||
    normalized.includes('forbidden') ||
    normalized.includes('403');
  if (scope === 'image') {
    return disabledOrUnavailable
      ? 'Automated image review unavailable'
      : 'Automated image review failed';
  }
  return disabledOrUnavailable
    ? 'Automated text review unavailable'
    : 'Automated text review failed';
}

const TEXT_BLOCK_PATTERNS = [
  { label: 'url', pattern: /https?:\/\//i },
  { label: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: 'phone', pattern: /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/ },
  { label: 'off_app_contact', pattern: /\b(text me|dm me|telegram|whatsapp|snapchat|cashapp|venmo|zelle)\b/i },
  { label: 'spam', pattern: /\b(click here|buy followers|crypto giveaway|guaranteed reviews?|limited time offer)\b/i },
  { label: 'sexual_content', pattern: /\b(adult services?|onlyfans|sex(?:ual)?|nsfw|nude)\b/i },
  { label: 'hate_or_slur', pattern: /\b(hate group|racial slur|white power|nazi)\b/i },
];

const SAFE_SHORT_TEXT_PATTERN = /^[a-z0-9\s:.,'"&()\-!/]+$/i;

/**
 * Collect user-visible string fields for moderation (not coords / ids).
 */
function buildTextBundle({
  name,
  description,
  atmosphere,
  notesForAdmin,
  customAmenities,
  playgroundType,
}) {
  const parts = [];
  if (name) parts.push(`name: ${name}`);
  if (description) parts.push(`description: ${description}`);
  if (atmosphere) parts.push(`atmosphere: ${atmosphere}`);
  if (notesForAdmin) parts.push(`notesForAdmin: ${notesForAdmin}`);
  if (playgroundType) parts.push(`playgroundType: ${playgroundType}`);
  if (Array.isArray(customAmenities) && customAmenities.length) {
    parts.push(`customAmenities: ${customAmenities.join(', ')}`);
  }
  return parts.join('\n');
}

function ruleReviewTextBundle(textBundle) {
  const normalized = normalizeText(textBundle);
  if (!normalized) {
    return null;
  }

  for (const { label, pattern } of TEXT_BLOCK_PATTERNS) {
    if (pattern.test(textBundle)) {
      return {
        appropriate: false,
        confidence: 0.99,
        severity: 'high',
        concerns: [`rule_blocked:${label}`],
        blocked: true,
        modelFailed: false,
      };
    }
  }

  const lineCount = textBundle
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .length;
  const looksShortAndPlain =
    normalized.length <= 120 &&
    lineCount <= 3 &&
    SAFE_SHORT_TEXT_PATTERN.test(textBundle) &&
    !/(.)\1{4,}/.test(normalized);

  if (looksShortAndPlain) {
    return {
      appropriate: true,
      confidence: 0.98,
      severity: 'none',
      concerns: [],
      blocked: false,
      modelFailed: false,
    };
  }

  return null;
}

async function reviewTextBundle(textBundle) {
  if (!textBundle || !textBundle.trim()) {
    return {
      appropriate: true,
      confidence: 1,
      severity: 'none',
      concerns: [],
      blocked: false,
      modelFailed: false,
    };
  }

  const cacheKey = buildTextReviewKey(textBundle);
  const cached = await getCachedRecord(TEXT_REVIEW_COLLECTION, cacheKey);
  if (cached) {
    return cached;
  }

  const ruleResult = ruleReviewTextBundle(textBundle);
  if (ruleResult) {
    await setCachedRecord(TEXT_REVIEW_COLLECTION, cacheKey, ruleResult, { source: 'rule' });
    return ruleResult;
  }

  if (!ai || !process.env.GEMINI_API_KEY) {
    console.warn('[playgroundSubmissionReview] GEMINI_API_KEY missing - failing closed (queue)');
    return {
      appropriate: false,
      confidence: 0,
      severity: 'high',
      concerns: ['Gemini text review unavailable'],
      blocked: true,
      modelFailed: true,
    };
  }

  const prompt = `You moderate text for a family-friendly "play places" mobile app (parks, playgrounds, museums, zoos, indoor play).

Evaluate ONLY the user-submitted text below for:
- hate / harassment / slurs
- sexual content or innuendo inappropriate for families
- graphic violence or self-harm instructions
- scams, phishing, or obvious spam
- doxxing or requests to move conversation off-app (still flag suspicious PII)

Return STRICT JSON only:
{
  "appropriate": boolean,
  "confidence": number from 0 to 1 (your confidence that the text is safe and appropriate),
  "severity": "none" | "low" | "medium" | "high",
  "concerns": string[] (short, empty if none),
  "blocked": boolean (true if the submission must NOT go live without human review)
}

If the text is empty or only whitespace, appropriate=true, severity=none, blocked=false.

USER TEXT:
---
${textBundle}
---`;

  try {
    const { logGeminiCall } = require('./geminiCostLogger');
    const model = getTextModel();
    const t0 = Date.now();
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });
    logGeminiCall({
      callSite: 'playgroundSubmissionReview.text',
      model,
      multimodal: false,
      ms: Date.now() - t0,
    });
    const parsed = JSON.parse(response.text);
    const appropriate = !!parsed.appropriate;
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    const severity = ['none', 'low', 'medium', 'high'].includes(parsed.severity) ? parsed.severity : 'medium';
    const concerns = Array.isArray(parsed.concerns) ? parsed.concerns : [];
    const blocked = !!parsed.blocked || !appropriate || severity === 'high';
    const result = { appropriate, confidence, severity, concerns, blocked, modelFailed: false };

    await setCachedRecord(TEXT_REVIEW_COLLECTION, cacheKey, result, {
      source: 'gemini',
      model,
    });
    return result;
  } catch (err) {
    console.error('[playgroundSubmissionReview] reviewTextBundle:', err.message);
    return {
      appropriate: false,
      confidence: 0,
      severity: 'high',
      concerns: [automatedReviewFailureConcern('text', err)],
      blocked: true,
      modelFailed: true,
    };
  }
}

/**
 * Vision check for inappropriate imagery (not playground-relevance - safety only).
 */
async function reviewImageBuffer(buffer, mimeTypeHint, placeName) {
  const cacheKey = buildImageReviewKey(buffer, placeName);
  const cached = await getCachedRecord(IMAGE_REVIEW_COLLECTION, cacheKey);
  if (cached) {
    return cached;
  }

  if (!ai || !process.env.GEMINI_API_KEY) {
    return {
      appropriate: false,
      confidence: 0,
      concerns: ['Gemini image review unavailable'],
      modelFailed: true,
    };
  }

  const mime = (mimeTypeHint && mimeTypeHint.startsWith('image/')) ? mimeTypeHint.split(';')[0] : 'image/jpeg';

  const prompt = `This image was submitted as a photo for a family-friendly venue listing: "${placeName || 'Unknown'}".

Answer ONLY with JSON:
{
  "appropriate": boolean,
  "confidence": number from 0 to 1,
  "concerns": string[] (e.g. "nudity", "graphic violence", "hate symbols", "illegal activity", "not a place photo" - empty if fine)
}

appropriate=true only if the image is safe for a family app (no sexual content, no graphic gore, no hate symbols, no illegal activity) AND it could plausibly show the venue or a generic family-friendly scene there. Reject random memes, screenshots of chats, or clearly unrelated content.`;

  try {
    const { logGeminiCall } = require('./geminiCostLogger');
    const model = getMultimodalModel();
    const t0 = Date.now();
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { data: buffer.toString('base64'), mimeType: mime } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      },
    });
    logGeminiCall({
      callSite: 'playgroundSubmissionReview.image',
      model,
      multimodal: true,
      ms: Date.now() - t0,
    });
    const parsed = JSON.parse(response.text);
    const appropriate = !!parsed.appropriate;
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    const concerns = Array.isArray(parsed.concerns) ? parsed.concerns : [];
    const result = { appropriate, confidence, concerns, modelFailed: false };

    await setCachedRecord(IMAGE_REVIEW_COLLECTION, cacheKey, result, {
      source: 'gemini',
      model,
      placeName: placeName || null,
    });
    return result;
  } catch (err) {
    console.error('[playgroundSubmissionReview] reviewImageBuffer:', err.message);
    return {
      appropriate: false,
      confidence: 0,
      concerns: [automatedReviewFailureConcern('image', err)],
      modelFailed: true,
    };
  }
}

function filterUserImageUrls(imageUrls) {
  const max = getMaxImages();
  return (imageUrls || [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u) && !u.startsWith('google_photo:'))
    .slice(0, max);
}

/**
 * Full submission review for POST new / PUT edit.
 * @returns {Promise<{ autoApprove: boolean, text: object, images: object[], minConfidenceThreshold: number }>}
 */
async function reviewPlaygroundSubmission(fields) {
  const minConf = getMinConfidence();
  const {
    name,
    description,
    atmosphere,
    notesForAdmin,
    customAmenities,
    playgroundType,
    imageUrls,
  } = fields;

  const textBundle = buildTextBundle({
    name,
    description,
    atmosphere,
    notesForAdmin,
    customAmenities,
    playgroundType,
  });

  const text = await reviewTextBundle(textBundle);

  const userUrls = filterUserImageUrls(imageUrls);
  const images = [];
  for (const url of userUrls) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        maxContentLength: 6 * 1024 * 1024,
        timeout: 15000,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const buf = Buffer.from(res.data);
      const ct = res.headers['content-type'] || 'image/jpeg';
      const img = await reviewImageBuffer(buf, ct, name || '');
      images.push({ url, ...img });
    } catch (e) {
      images.push({
        url,
        appropriate: false,
        confidence: 0,
        concerns: ['Submitted image could not be processed automatically'],
        modelFailed: true,
      });
    }
  }

  let autoApprove = true;

  if (text.blocked || !text.appropriate || text.confidence < minConf) {
    autoApprove = false;
  }
  if (text.severity === 'high') {
    autoApprove = false;
  }
  if (text.severity === 'medium' && text.confidence < Math.max(minConf, 0.9)) {
    autoApprove = false;
  }

  for (const img of images) {
    if (img.modelFailed || !img.appropriate || img.confidence < minConf) {
      autoApprove = false;
      break;
    }
  }

  return {
    autoApprove,
    minConfidenceThreshold: minConf,
    text,
    images,
    reviewedAt: new Date().toISOString(),
  };
}

module.exports = {
  reviewPlaygroundSubmission,
  buildTextBundle,
  ruleReviewTextBundle,
};
