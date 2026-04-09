const mockAnnotateImage = jest.fn();
const mockLabelDetection = jest.fn();
const mockDetectFaces = jest.fn();
const mockApplyStickerMasks = jest.fn();
const mockPublicFile = jest.fn();

jest.mock('@google-cloud/vision', () => ({
  ImageAnnotatorClient: jest.fn(() => ({
    annotateImage: mockAnnotateImage,
    labelDetection: mockLabelDetection,
  })),
}));

jest.mock('../services/storageService', () => ({
  publicBucket: {
    name: 'playground_app_bucket',
    file: mockPublicFile,
  },
}));

jest.mock('../services/faceStickerMaskService', () => ({
  detectFaces: mockDetectFaces,
  applyStickerMasks: mockApplyStickerMasks,
}));

const { blurFaces, reviewEdit, reviewPhoto } = require('../services/aiModerationService');

function mockGcsFile(overrides = {}) {
  return {
    download: jest.fn().mockResolvedValue([Buffer.from('original')]),
    getMetadata: jest.fn().mockResolvedValue([{ mediaLink: 'https://cdn.example/original.jpg' }]),
    save: jest.fn().mockResolvedValue(),
    ...overrides,
  };
}

describe('aiModerationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnnotateImage.mockResolvedValue([{
      safeSearchAnnotation: {},
      faceAnnotations: [],
    }]);
    mockLabelDetection.mockResolvedValue([{ labelAnnotations: [{ description: 'Playground' }] }]);
    mockDetectFaces.mockResolvedValue([]);
    mockApplyStickerMasks.mockResolvedValue(Buffer.from('masked'));
    mockPublicFile.mockImplementation(() => mockGcsFile());
  });

  test('reviewPhoto rejects unsafe SafeSearch results', async () => {
    mockAnnotateImage.mockResolvedValueOnce([{
      safeSearchAnnotation: { adult: 'LIKELY', violence: 'UNLIKELY', racy: 'VERY_UNLIKELY' },
      faceAnnotations: [],
    }]);

    await expect(reviewPhoto('https://example.com/photo.jpg')).resolves.toEqual({
      approved: false,
      reason: 'Inappropriate content detected (adult=LIKELY, violence=UNLIKELY, racy=VERY_UNLIKELY)',
      hasFaces: false,
      onlyFaces: false,
    });
    expect(mockLabelDetection).not.toHaveBeenCalled();
  });

  test('reviewPhoto rejects face-only images but allows faces with playground context', async () => {
    mockAnnotateImage.mockResolvedValueOnce([{
      safeSearchAnnotation: {},
      faceAnnotations: [{ joyLikelihood: 'LIKELY' }],
    }]);
    mockLabelDetection.mockResolvedValueOnce([{
      labelAnnotations: [{ description: 'Face' }, { description: 'Person' }],
    }]);

    await expect(reviewPhoto('https://example.com/selfie.jpg')).resolves.toEqual({
      approved: false,
      reason: 'Photo appears to contain only faces. Please submit photos of the play place itself.',
      hasFaces: true,
      onlyFaces: true,
    });

    mockAnnotateImage.mockResolvedValueOnce([{
      safeSearchAnnotation: {},
      faceAnnotations: [{ joyLikelihood: 'LIKELY' }],
    }]);
    mockLabelDetection.mockResolvedValueOnce([{
      labelAnnotations: [{ description: 'Person' }, { description: 'Slide' }],
    }]);

    await expect(reviewPhoto('https://example.com/playground.jpg')).resolves.toEqual({
      approved: true,
      reason: null,
      hasFaces: true,
      onlyFaces: false,
    });
  });

  test('reviewPhoto fails open when Vision throws', async () => {
    mockAnnotateImage.mockRejectedValueOnce(new Error('vision unavailable'));

    await expect(reviewPhoto('https://example.com/photo.jpg')).resolves.toEqual({
      approved: true,
      reason: null,
      hasFaces: false,
      onlyFaces: false,
    });
  });

  test('reviewEdit blocks spam and URLs but allows empty or clean edits', async () => {
    await expect(reviewEdit({ name: 'Clean Park', notes: 'Nice shaded play area' })).resolves.toEqual({
      approved: true,
      reason: null,
    });
    await expect(reviewEdit({ notes: 'Visit http://example.test' })).resolves.toEqual({
      approved: false,
      reason: 'Edit contains disallowed content (matched: https?:\\/\\/)',
    });
    await expect(reviewEdit({ notes: 'This is a phishing scam' })).resolves.toEqual({
      approved: false,
      reason: 'Edit contains disallowed content (matched: \\b(spam|scam|fake|phishing)\\b)',
    });
    await expect(reviewEdit({ count: 3, open: true })).resolves.toEqual({
      approved: true,
      reason: null,
    });
  });

  test('blurFaces returns the original media link when no faces are detected', async () => {
    const originalFile = mockGcsFile({
      getMetadata: jest.fn().mockResolvedValue([{ mediaLink: 'https://cdn.example/source.jpg' }]),
    });
    mockPublicFile.mockReturnValue(originalFile);

    await expect(blurFaces('photos/source.jpg')).resolves.toBe('https://cdn.example/source.jpg');
    expect(mockDetectFaces).toHaveBeenCalledWith(Buffer.from('original'));
    expect(mockApplyStickerMasks).not.toHaveBeenCalled();
  });

  test('blurFaces saves a masked copy when faces are found', async () => {
    const originalFile = mockGcsFile();
    const maskedFile = mockGcsFile();
    mockPublicFile
      .mockReturnValueOnce(originalFile)
      .mockReturnValueOnce(maskedFile);
    mockDetectFaces.mockResolvedValueOnce([{ boundingPoly: { vertices: [] } }]);

    await expect(blurFaces('photos/source.jpeg')).resolves.toBe(
      'https://storage.googleapis.com/playground_app_bucket/photos/source-masked.jpeg',
    );
    expect(mockApplyStickerMasks).toHaveBeenCalledWith(Buffer.from('original'), [{ boundingPoly: { vertices: [] } }]);
    expect(mockPublicFile).toHaveBeenLastCalledWith('photos/source-masked.jpeg');
    expect(maskedFile.save).toHaveBeenCalledWith(Buffer.from('masked'), {
      metadata: { contentType: 'image/jpeg' },
    });
  });

  test('blurFaces fails open to the original storage URL if masking errors', async () => {
    mockPublicFile.mockReturnValue(mockGcsFile({
      download: jest.fn().mockRejectedValue(new Error('download failed')),
      getMetadata: jest.fn().mockResolvedValue([{}]),
    }));

    await expect(blurFaces('photos/source')).resolves.toBe(
      'https://storage.googleapis.com/playground_app_bucket/photos/source',
    );
  });
});
