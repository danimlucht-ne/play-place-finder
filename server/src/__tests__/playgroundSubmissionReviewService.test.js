const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../services/geminiCostLogger', () => ({ logGeminiCall: jest.fn() }));

const axios = require('axios');
const { logGeminiCall } = require('../services/geminiCostLogger');
const {
  buildTextBundle,
  reviewPlaygroundSubmission,
  ruleReviewTextBundle,
} = require('../services/playgroundSubmissionReviewService');

/** Enough characters that ruleReviewTextBundle does not treat the bundle as “short and plain” (see SAFE_SHORT_TEXT_PATTERN). */
const LONG_TO_FORCE_GEMINI = 'More detail so moderation cannot skip the model. '.padEnd(160, 'x');

describe('playgroundSubmissionReviewService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.PLAYGROUND_REVIEW_MIN_AUTO_CONFIDENCE = '0.82';
    delete process.env.PLAYGROUND_REVIEW_MAX_IMAGES;
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        appropriate: true,
        confidence: 0.95,
        severity: 'none',
        concerns: [],
        blocked: false,
      }),
    });
    axios.get.mockResolvedValue({
      data: Buffer.from('image'),
      headers: { 'content-type': 'image/png' },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.GEMINI_API_KEY;
    delete process.env.PLAYGROUND_REVIEW_MIN_AUTO_CONFIDENCE;
    delete process.env.PLAYGROUND_REVIEW_MAX_IMAGES;
  });

  test('buildTextBundle includes only user-visible moderation fields', () => {
    expect(buildTextBundle({
      name: 'Elm Park',
      description: 'Shaded playground',
      atmosphere: 'Calm',
      notesForAdmin: 'Please verify hours',
      playgroundType: 'park',
      customAmenities: ['story walk', 'sandbox'],
      latitude: 41.2,
    })).toBe([
      'name: Elm Park',
      'description: Shaded playground',
      'atmosphere: Calm',
      'notesForAdmin: Please verify hours',
      'playgroundType: park',
      'customAmenities: story walk, sandbox',
    ].join('\n'));
  });

  test('ruleReviewTextBundle blocks obvious spam/off-app contact and auto-approves plain short text', () => {
    expect(ruleReviewTextBundle('name: Elm Park\ndescription: Nice slides')).toEqual({
      appropriate: true,
      confidence: 0.98,
      severity: 'none',
      concerns: [],
      blocked: false,
      modelFailed: false,
    });

    expect(ruleReviewTextBundle('description: click here and text me at 402-555-1212')).toEqual({
      appropriate: false,
      confidence: 0.99,
      severity: 'high',
      concerns: ['rule_blocked:phone'],
      blocked: true,
      modelFailed: false,
    });
  });

  test('auto-approves empty safe submissions without calling Gemini or fetching images', async () => {
    await expect(reviewPlaygroundSubmission({ imageUrls: ['google_photo:abc'] })).resolves.toEqual({
      autoApprove: true,
      minConfidenceThreshold: 0.82,
      text: {
        appropriate: true,
        confidence: 1,
        severity: 'none',
        concerns: [],
        blocked: false,
        modelFailed: false,
      },
      images: [],
      reviewedAt: '2026-04-09T12:00:00.000Z',
    });
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('fails closed when Gemini API key is missing', async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await reviewPlaygroundSubmission({
      name: 'Elm Park',
      description: LONG_TO_FORCE_GEMINI,
    });

    expect(result.autoApprove).toBe(false);
    expect(result.text).toEqual({
      appropriate: false,
      confidence: 0,
      severity: 'high',
      concerns: ['Gemini text review unavailable'],
      blocked: true,
      modelFailed: true,
    });
  });

  test('reviews safe text and the allowed number of user images for auto-approval', async () => {
    process.env.PLAYGROUND_REVIEW_MAX_IMAGES = '1';
    mockGenerateContent
      .mockResolvedValueOnce({
        text: JSON.stringify({
          appropriate: true,
          confidence: 0.96,
          severity: 'none',
          concerns: [],
          blocked: false,
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          appropriate: true,
          confidence: 0.91,
          concerns: [],
        }),
      });

    const result = await reviewPlaygroundSubmission({
      name: 'Elm Park',
      // Long description so text review uses Gemini; image review is the 2nd generateContent call.
      description: `Clean slides and shaded benches. ${LONG_TO_FORCE_GEMINI}`,
      imageUrls: [
        'https://cdn.example/one.jpg',
        'google_photo:abc',
        'https://cdn.example/two.jpg',
      ],
    });

    expect(result.autoApprove).toBe(true);
    expect(result.images).toEqual([{
      url: 'https://cdn.example/one.jpg',
      appropriate: true,
      confidence: 0.91,
      concerns: [],
      modelFailed: false,
    }]);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith('https://cdn.example/one.jpg', expect.objectContaining({
      responseType: 'arraybuffer',
      timeout: 15000,
    }));
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(logGeminiCall).toHaveBeenCalledWith(expect.objectContaining({
      callSite: 'playgroundSubmissionReview.text',
      multimodal: false,
    }));
    expect(logGeminiCall).toHaveBeenCalledWith(expect.objectContaining({
      callSite: 'playgroundSubmissionReview.image',
      multimodal: true,
    }));
  });

  test('uses rule-first text approval to skip Gemini for simple safe copy', async () => {
    const result = await reviewPlaygroundSubmission({
      name: 'Elm Park',
      description: 'Nice slides',
    });

    expect(result.autoApprove).toBe(true);
    expect(result.text).toEqual({
      appropriate: true,
      confidence: 0.98,
      severity: 'none',
      concerns: [],
      blocked: false,
      modelFailed: false,
    });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  test('requires admin review for blocked text, medium severity below stricter threshold, or failed image fetches', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        appropriate: true,
        confidence: 0.86,
        severity: 'medium',
        concerns: ['possibly promotional'],
        blocked: false,
      }),
    });

    const medium = await reviewPlaygroundSubmission({
      name: 'Elm Park',
      description: `Maybe promotional. ${LONG_TO_FORCE_GEMINI}`,
    });
    expect(medium.autoApprove).toBe(false);
    expect(medium.text.severity).toBe('medium');

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        appropriate: false,
        confidence: 0.99,
        severity: 'high',
        concerns: ['unsafe'],
        blocked: true,
      }),
    });
    const blocked = await reviewPlaygroundSubmission({
      name: 'Unsafe text',
      description: LONG_TO_FORCE_GEMINI,
    });
    expect(blocked.autoApprove).toBe(false);
    expect(blocked.text.blocked).toBe(true);

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        appropriate: true,
        confidence: 0.98,
        severity: 'none',
        concerns: [],
        blocked: false,
      }),
    });
    axios.get.mockRejectedValueOnce(new Error('image fetch failed'));
    const imageFailed = await reviewPlaygroundSubmission({
      name: 'Elm Park',
      description: LONG_TO_FORCE_GEMINI,
      imageUrls: ['https://cdn.example/broken.jpg'],
    });
    expect(imageFailed.autoApprove).toBe(false);
    expect(imageFailed.images).toEqual([{
      url: 'https://cdn.example/broken.jpg',
      appropriate: false,
      confidence: 0,
      concerns: ['Submitted image could not be processed automatically'],
      modelFailed: true,
    }]);
  });

  test('fails closed when Gemini returns malformed JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: '{not-json' });

    const result = await reviewPlaygroundSubmission({
      name: 'Elm Park',
      description: LONG_TO_FORCE_GEMINI,
    });

    expect(result.autoApprove).toBe(false);
    expect(result.text.modelFailed).toBe(true);
    expect(result.text.concerns[0]).toBe('Automated text review failed');
  });
});
