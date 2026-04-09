const mockMetadata = jest.fn();
const mockSharp = jest.fn(() => ({ metadata: mockMetadata }));

jest.mock('sharp', () => mockSharp);
jest.mock('../services/faceStickerMaskService', () => ({
  detectFaces: jest.fn(),
  applyStickerMasks: jest.fn(),
}));
jest.mock('../services/photoClassificationService', () => ({
  getGeminiSummary: jest.fn(),
}));

const { detectFaces, applyStickerMasks } = require('../services/faceStickerMaskService');
const { getGeminiSummary } = require('../services/photoClassificationService');
const { moderatePhoto } = require('../services/photoModerationService');

function face(width = 10, height = 10) {
  return {
    boundingPoly: {
      vertices: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
    },
  };
}

describe('photoModerationService', () => {
  const imageBuffer = Buffer.from('image');

  beforeEach(() => {
    jest.clearAllMocks();
    mockMetadata.mockResolvedValue({ width: 100, height: 100 });
    detectFaces.mockResolvedValue([]);
    applyStickerMasks.mockResolvedValue(Buffer.from('masked'));
    getGeminiSummary.mockResolvedValue({
      recommendedAction: 'AUTO_APPROVE',
      confidence: 0.9,
      peopleDetected: false,
      notes: 'Useful playground overview',
    });
  });

  test('fails closed when face detection is unavailable', async () => {
    detectFaces.mockRejectedValueOnce(new Error('vision down'));

    await expect(moderatePhoto(imageBuffer)).resolves.toEqual(expect.objectContaining({
      status: 'FAILED',
      reason: 'Face detection service failed.',
      actionTaken: 'NONE',
      processedBuffer: imageBuffer,
    }));
  });

  test('rejects photos with too many faces before running Gemini', async () => {
    detectFaces.mockResolvedValueOnce([face(), face(), face(), face(), face(), face()]);

    const result = await moderatePhoto(imageBuffer);

    expect(result).toEqual(expect.objectContaining({
      status: 'REJECTED',
      actionTaken: 'REJECT',
      reason: 'Too many faces detected (6 > 5).',
      moderationFlags: ['TOO_MANY_FACES'],
    }));
    expect(getGeminiSummary).not.toHaveBeenCalled();
  });

  test('rejects photos where a face occupies too much of the image', async () => {
    detectFaces.mockResolvedValueOnce([face(60, 60)]);

    const result = await moderatePhoto(imageBuffer);

    expect(result.status).toBe('REJECTED');
    expect(result.actionTaken).toBe('REJECT');
    expect(result.reason).toBe('Face is too prominent (occupies 36% of image).');
    expect(result.moderationFlags).toEqual(['PROMINENT_FACE']);
  });

  test('rejects photos Gemini classifies as not useful or inappropriate', async () => {
    getGeminiSummary.mockResolvedValueOnce({
      recommendedAction: 'REJECT',
      confidence: 0.8,
      peopleDetected: false,
      notes: 'Not a playground photo',
    });

    const result = await moderatePhoto(imageBuffer, ['park'], 'Elm Park');

    expect(getGeminiSummary).toHaveBeenCalledWith(imageBuffer, 0, ['park'], 'Elm Park');
    expect(result).toEqual(expect.objectContaining({
      status: 'REJECTED',
      actionTaken: 'REJECT',
      reason: 'Not a playground photo',
      moderationFlags: ['AI_REJECTED_USEFULNESS'],
    }));
  });

  test('masks acceptable faces and auto-approves when Gemini confidence is high', async () => {
    detectFaces.mockResolvedValueOnce([face(20, 20)]);
    getGeminiSummary.mockResolvedValueOnce({
      recommendedAction: 'AUTO_APPROVE',
      confidence: 0.85,
      peopleDetected: true,
      notes: 'Playground visible',
    });

    const result = await moderatePhoto(imageBuffer);

    expect(applyStickerMasks).toHaveBeenCalledWith(imageBuffer, [face(20, 20)]);
    expect(result.status).toBe('AUTO_APPROVED');
    expect(result.peopleDetected).toBe(true);
    expect(result.processedBuffer).toEqual(Buffer.from('masked'));
    expect(result.moderationFlags).toEqual([
      'STICKER_MASK_APPLIED',
      'STICKER_MASK_AUTO_APPROVED',
    ]);
  });

  test('routes masked face photos to admin review when confidence is low', async () => {
    detectFaces.mockResolvedValueOnce([face(10, 10)]);
    getGeminiSummary.mockResolvedValueOnce({
      recommendedAction: 'AUTO_APPROVE',
      confidence: 0.5,
      peopleDetected: true,
      notes: 'Maybe useful',
    });

    const result = await moderatePhoto(imageBuffer);

    expect(result.status).toBe('NEEDS_ADMIN_REVIEW');
    expect(result.actionTaken).toBe('STICKER_MASK');
    expect(result.moderationFlags).toEqual([
      'STICKER_MASK_APPLIED',
      'NEEDS_ADMIN_REVIEW',
    ]);
  });
});
