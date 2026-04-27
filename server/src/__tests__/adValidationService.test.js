const mockSafeSearchDetection = jest.fn();
const mockGenerateContent = jest.fn();

jest.mock('@google-cloud/vision', () => ({
  ImageAnnotatorClient: jest.fn(() => ({ safeSearchDetection: mockSafeSearchDetection })),
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

jest.mock('axios', () => ({
  head: jest.fn(),
  get: jest.fn(),
}));

jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/retryWithBackoff', () => ({
  retryWithBackoff: jest.fn((fn) => fn()),
}));
jest.mock('../services/geminiCostLogger', () => ({
  logGeminiCall: jest.fn(),
}));
jest.mock('../services/campaignLifecycleService', () => ({
  activateCampaign: jest.fn(),
}));
jest.mock('../services/stripeService', () => ({
  captureOrChargeSubmission: jest.fn(),
  refund: jest.fn(),
  releaseAuthorization: jest.fn(),
}));
jest.mock('../services/adCampaignEmailTriggers', () => ({
  notifyPaymentCapturedIfNeeded: jest.fn(),
}));

const axios = require('axios');
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const campaignLifecycleService = require('../services/campaignLifecycleService');
const stripeService = require('../services/stripeService');
const { notifyPaymentCapturedIfNeeded } = require('../services/adCampaignEmailTriggers');
const {
  checkFamilyFriendliness,
  finalizeValidation,
  isLikelyBenignHealthcare,
  runValidation,
  validateImage,
  validateUrl,
} = require('../services/adValidationService');

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

function baseSubmission(overrides = {}) {
  return {
    _id: 'sub-1',
    advertiserId: 'adv-1',
    creativeId: 'creative-1',
    currentStep: 3,
    package: { type: 'sponsored_listing', durationDays: 30 },
    ...overrides,
  };
}

function baseAdvertiser(overrides = {}) {
  return {
    _id: 'adv-1',
    businessName: 'Play Cafe',
    category: 'kids',
    contactEmail: 'owner@test.invalid',
    regionKey: 'omaha-ne',
    description: 'Family fun',
    ...overrides,
  };
}

function baseCreative(overrides = {}) {
  return {
    _id: 'creative-1',
    headline: 'Family play day',
    body: 'Bring the kids for a safe indoor play session',
    imageUrl: 'https://example.com/ad.jpg',
    ctaUrl: 'https://example.com',
    ...overrides,
  };
}

describe('adValidationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
    mockSafeSearchDetection.mockResolvedValue([{ safeSearchAnnotation: {} }]);
    mockGenerateContent.mockResolvedValue({
      text: '{ "familyFriendly": true, "reason": "Looks appropriate" }',
    });
    axios.head.mockResolvedValue({ status: 204 });
    axios.get.mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('recognizes conventional healthcare names as benign without over-blocking ordinary names', () => {
    expect(isLikelyBenignHealthcare('Dani Lucht Physical Therapy')).toBe(true);
    expect(isLikelyBenignHealthcare('Pediatric Dental Studio')).toBe(true);
    expect(isLikelyBenignHealthcare('Adult Lounge')).toBe(false);
  });

  test('validateImage handles safe, unsafe, and service-error SafeSearch outcomes', async () => {
    await expect(validateImage('https://example.com/safe.jpg')).resolves.toEqual({
      safe: true,
      flags: [],
    });

    mockSafeSearchDetection.mockResolvedValueOnce([{
      safeSearchAnnotation: { adult: 'LIKELY', violence: 'VERY_LIKELY', racy: 'UNLIKELY' },
    }]);
    await expect(validateImage('https://example.com/unsafe.jpg')).resolves.toEqual({
      safe: false,
      flags: ['unsafe_image'],
    });

    mockSafeSearchDetection.mockRejectedValueOnce(new Error('vision down'));
    await expect(validateImage('https://example.com/error.jpg')).resolves.toEqual({
      safe: false,
      flags: ['validation_service_error'],
    });
  });

  test('validateUrl uses HEAD first, falls back to GET, and reports invalid URLs', async () => {
    await expect(validateUrl('https://example.com')).resolves.toEqual({ valid: true });
    expect(axios.get).not.toHaveBeenCalled();

    axios.head.mockRejectedValueOnce(new Error('HEAD not allowed'));
    axios.get.mockResolvedValueOnce({ status: 302 });
    await expect(validateUrl('https://fallback.example')).resolves.toEqual({ valid: true });

    axios.head.mockRejectedValueOnce(new Error('offline'));
    axios.get.mockRejectedValueOnce(new Error('offline'));
    await expect(validateUrl('https://down.example')).resolves.toEqual({
      valid: false,
      reason: 'offline',
    });
  });

  test('checkFamilyFriendliness skips Gemini for clearly benign healthcare and parses Gemini JSON otherwise', async () => {
    await expect(checkFamilyFriendliness(
      'Lucht Physical Therapy',
      'health',
      'Therapy clinic',
      'Move better',
      'Family care',
    )).resolves.toEqual({
      familyFriendly: true,
      reason: 'Conventional healthcare/services — no LLM review',
    });
    expect(mockGenerateContent).not.toHaveBeenCalled();

    mockGenerateContent.mockResolvedValueOnce({
      text: '```json\n{ "familyFriendly": false, "reason": "Adult-only service" }\n```',
    });
    await expect(checkFamilyFriendliness(
      'Night Lounge',
      'entertainment',
      'Adults only',
      'Act now',
      'VIP night',
    )).resolves.toEqual({
      familyFriendly: false,
      reason: 'Adult-only service',
    });
  });

  test('runValidation skips already-checked submissions', async () => {
    const submission = baseSubmission({
      validationResult: {
        checkedAt: new Date('2026-04-01T00:00:00Z'),
        decision: 'manual_review',
        flags: ['premium_placement'],
      },
    });
    getDb.mockReturnValue(makeDb({
      adSubmissions: { findOne: jest.fn().mockResolvedValue(submission) },
    }));

    await expect(runValidation('sub-1')).resolves.toEqual({
      decision: 'manual_review',
      flags: ['premium_placement'],
      skipped: true,
    });
  });

  test('runValidation auto-rejects prohibited categories and disposable email domains', async () => {
    const rejectUpdateOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue(baseSubmission({ paymentIntentId: 'pi_reject' })),
        updateOne: rejectUpdateOne,
      },
      advertisers: { findOne: jest.fn().mockResolvedValue(baseAdvertiser({ category: 'gambling' })) },
      adCreatives: { findOne: jest.fn().mockResolvedValue(baseCreative()) },
      paymentTransactions: { findOne: jest.fn().mockResolvedValue(null) },
    }));

    await expect(runValidation('sub-1')).resolves.toEqual({
      decision: 'auto_reject',
      flags: ['prohibited_category'],
    });
    expect(rejectUpdateOne).toHaveBeenCalledWith(
      { _id: 'sub-1' },
      { $set: expect.objectContaining({ status: 'rejected', rejectedAt: new Date('2026-04-09T12:00:00Z') }) },
    );
    expect(stripeService.refund).toHaveBeenCalledWith('pi_reject', 'Submission rejected: prohibited_category');

    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue(baseSubmission()),
        updateOne: jest.fn().mockResolvedValue({}),
      },
      advertisers: { findOne: jest.fn().mockResolvedValue(baseAdvertiser({ contactEmail: 'spam@tempmail.com' })) },
      adCreatives: { findOne: jest.fn().mockResolvedValue(baseCreative()) },
      paymentTransactions: { findOne: jest.fn().mockResolvedValue(null) },
    }));

    await expect(runValidation('sub-1')).resolves.toEqual({
      decision: 'auto_reject',
      flags: ['fraud_disposable_email'],
    });
  });

  test('runValidation aggregates manual-review flags for copy, URL, premium placement, and duplicates', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    const insertMany = jest.fn().mockResolvedValue({});
    axios.head.mockRejectedValueOnce(new Error('offline'));
    axios.get.mockRejectedValueOnce(new Error('offline'));
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue(baseSubmission({
          package: { type: 'featured_home', durationDays: 30 },
        })),
        updateOne,
      },
      advertisers: {
        findOne: jest.fn()
          .mockResolvedValueOnce(baseAdvertiser())
          .mockResolvedValueOnce(baseAdvertiser({ _id: 'adv-2' })),
      },
      adCreatives: {
        findOne: jest.fn().mockResolvedValue(baseCreative({
          headline: 'Act now families',
          body: 'Guaranteed free money for everyone',
          businessName: 'Play Cafe',
        })),
      },
      paymentTransactions: { findOne: jest.fn().mockResolvedValue(null) },
      reviewFlags: { insertMany },
    }));

    await expect(runValidation('sub-1')).resolves.toEqual({
      decision: 'manual_review',
      flags: ['suspicious_content', 'no_online_presence', 'premium_placement', 'duplicate_business'],
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'sub-1' },
      { $set: expect.objectContaining({ status: 'manual_review', currentStep: 6 }) },
    );
    expect(insertMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ flagType: 'suspicious_content', severity: 'medium' }),
      expect.objectContaining({ flagType: 'premium_placement', severity: 'low' }),
    ]));
    expect(notifyPaymentCapturedIfNeeded).toHaveBeenCalledWith('sub-1');
  });

  test('finalizeValidation captures manual-auth approvals, activates paid campaigns, and inserts review flags', async () => {
    const submission = baseSubmission({
      paymentMode: 'manual_capture',
      paymentIntentId: 'pi_capture',
    });
    const updateSubmission = jest.fn().mockResolvedValue({});
    const updatePayment = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue(submission),
        updateOne: updateSubmission,
      },
      paymentTransactions: {
        findOne: jest.fn().mockResolvedValue(null),
        updateOne: updatePayment,
      },
    }));

    await expect(finalizeValidation('sub-1', 'auto_approve', [])).resolves.toEqual({
      decision: 'auto_approve',
      flags: [],
    });

    expect(stripeService.captureOrChargeSubmission).toHaveBeenCalledWith(submission);
    expect(updatePayment).toHaveBeenCalledWith(
      { submissionId: 'sub-1', stripePaymentIntentId: 'pi_capture' },
      { $set: { status: 'succeeded', updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(updateSubmission).toHaveBeenCalledWith(
      { _id: 'sub-1' },
      { $set: expect.objectContaining({ status: 'approved', paymentStatus: 'captured' }) },
    );
    expect(campaignLifecycleService.activateCampaign).toHaveBeenCalledWith('sub-1');

    const insertMany = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue(baseSubmission()),
        updateOne: jest.fn().mockResolvedValue({}),
      },
      paymentTransactions: { findOne: jest.fn().mockResolvedValue(null) },
      reviewFlags: { insertMany },
    }));

    await finalizeValidation('sub-1', 'manual_review', ['not_family_friendly']);
    expect(insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        submissionId: 'sub-1',
        flagType: 'not_family_friendly',
        severity: 'high',
        resolvedAt: null,
      }),
    ]);
  });

  test('finalizeValidation releases uncaptured authorizations and refunds captured charge intents on rejection', async () => {
    getDb.mockReturnValueOnce(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue(baseSubmission({
          paymentMode: 'manual_capture',
          paymentIntentId: 'pi_auth',
        })),
        updateOne: jest.fn().mockResolvedValue({}),
      },
      paymentTransactions: { findOne: jest.fn().mockResolvedValue(null) },
    }));
    await finalizeValidation('sub-1', 'auto_reject', ['unsafe_image']);
    expect(stripeService.releaseAuthorization).toHaveBeenCalledWith(
      'pi_auth',
      'Submission rejected: unsafe_image',
    );

    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue(baseSubmission({ paymentIntentId: 'pi_charge' })),
        updateOne: jest.fn().mockResolvedValue({}),
      },
      paymentTransactions: { findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), status: 'succeeded' }) },
    }));
    await finalizeValidation('sub-1', 'auto_reject', ['prohibited_category']);
    expect(stripeService.refund).toHaveBeenCalledWith(
      'pi_charge',
      'Submission rejected: prohibited_category',
    );
    expect(notifyPaymentCapturedIfNeeded).not.toHaveBeenCalledWith('sub-1');
  });
});
