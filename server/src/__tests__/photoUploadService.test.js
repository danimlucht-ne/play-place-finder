const mockBucket = {
  name: 'playground_app_bucket',
  file: jest.fn(),
};
const mockFile = {
  name: 'quarantine/original-photo.jpg',
  getSignedUrl: jest.fn(),
  download: jest.fn(),
  save: jest.fn(),
};

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({ bucket: jest.fn(() => mockBucket) })),
}));
jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/photoModerationService', () => ({ moderatePhoto: jest.fn() }));
jest.mock('../services/photoCleanupService', () => ({ deleteFromQuarantine: jest.fn() }));
jest.mock('../services/contributionService', () => ({ recordContribution: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendAdminNotificationEmail: jest.fn() }));
jest.mock('../services/equipmentValidationService', () => ({
  computePhotoScore: jest.fn(),
  mergeAndRevalidate: jest.fn(),
  rerankGallery: jest.fn(),
}));

const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const { moderatePhoto } = require('../services/photoModerationService');
const { deleteFromQuarantine } = require('../services/photoCleanupService');
const contributionService = require('../services/contributionService');
const { sendAdminNotificationEmail } = require('../services/notificationService');
const equipmentValidationService = require('../services/equipmentValidationService');
const { initPhotoUpload, processPhoto } = require('../services/photoUploadService');

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

describe('photoUploadService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
    mockFile.name = 'quarantine/original-photo.jpg';
    mockFile.getSignedUrl.mockResolvedValue(['https://signed.example/upload']);
    mockFile.download.mockResolvedValue([Buffer.from('original')]);
    mockFile.save.mockResolvedValue();
    mockBucket.file.mockImplementation((name) => ({
      name,
      getSignedUrl: mockFile.getSignedUrl,
      download: mockFile.download,
      save: mockFile.save,
    }));
    equipmentValidationService.computePhotoScore.mockReturnValue(0.87);
    equipmentValidationService.mergeAndRevalidate.mockResolvedValue({});
    equipmentValidationService.rerankGallery.mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('initPhotoUpload creates a pending quarantine record and signed upload URL', async () => {
    const insertOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      photo_uploads: { insertOne },
    }));

    const result = await initPhotoUpload('family.jpg', 'image/png', {
      adultTermsAccepted: true,
      adultTermsConsentVersion: 'v1',
    });

    expect(result).toEqual({
      uploadUrl: 'https://signed.example/upload',
      fileId: expect.stringContaining('quarantine/original-'),
      photoRecordId: expect.any(String),
    });
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      _id: expect.any(ObjectId),
      status: 'PENDING',
      playgroundId: null,
      uploadedBy: null,
      tempObjectPath: expect.stringContaining('quarantine/original-'),
      adultTermsAccepted: true,
      adultTermsConsentVersion: 'v1',
      createdAt: new Date('2026-04-09T12:00:00Z'),
      quarantineExpiresAt: new Date('2026-04-10T12:00:00Z'),
    }));
    expect(mockFile.getSignedUrl).toHaveBeenCalledWith({
      version: 'v4',
      action: 'write',
      expires: new Date('2026-04-09T12:15:00Z').getTime(),
      contentType: 'image/png',
    });
  });

  test('processPhoto auto-approves, stores public photo, records contribution, scores, merges, and reranks', async () => {
    const photoId = new ObjectId('64f1a9f7c2a7d9b123456789');
    const playgroundId = new ObjectId('64f1a9f7c2a7d9b123456700');
    const updatePhoto = jest.fn().mockResolvedValue({});
    const updateScore = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      photo_uploads: {
        findOne: jest.fn().mockResolvedValue({
          _id: photoId,
          tempObjectPath: 'quarantine/original-photo.jpg',
        }),
        updateOne: updatePhoto,
      },
      users: {
        findOne: jest.fn().mockResolvedValue(null),
      },
      playgrounds: {
        findOne: jest.fn().mockResolvedValue({
          _id: playgroundId,
          name: 'Elm Park',
          city: 'Omaha',
          types: ['park'],
        }),
      },
      photo_scores: { updateOne: updateScore },
    }));
    moderatePhoto.mockResolvedValue({
      status: 'AUTO_APPROVED',
      processedBuffer: Buffer.from('processed'),
      peopleDetected: false,
      faceCount: 0,
      actionTaken: 'NONE',
      reason: null,
      geminiSummary: {
        photoUseful: true,
        playgroundVisible: true,
        detectedFeatures: { equipment: ['Slide'] },
      },
      moderationFlags: [],
    });

    await expect(processPhoto(photoId.toHexString(), playgroundId, 'user-1')).resolves.toEqual({
      status: 'AUTO_APPROVED',
      url: 'https://storage.googleapis.com/playground_app_bucket/public-64f1a9f7c2a7d9b123456789.jpeg',
      reason: null,
    });

    expect(moderatePhoto).toHaveBeenCalledWith(Buffer.from('original'), ['park'], 'Elm Park');
    expect(mockBucket.file).toHaveBeenCalledWith('public-64f1a9f7c2a7d9b123456789.jpeg');
    expect(mockFile.save).toHaveBeenCalledWith(Buffer.from('processed'), { contentType: 'image/jpeg' });
    expect(deleteFromQuarantine).toHaveBeenCalledWith('quarantine/original-photo.jpg');
    expect(contributionService.recordContribution).toHaveBeenCalledWith(
      'user-1',
      'PHOTO',
      photoId.toHexString(),
      'Omaha',
    );
    expect(updateScore).toHaveBeenCalledWith(
      {
        playgroundId,
        photoUrl: 'https://storage.googleapis.com/playground_app_bucket/public-64f1a9f7c2a7d9b123456789.jpeg',
      },
      { $set: expect.objectContaining({ score: 0.87, source: 'user_upload', uploadedBy: 'user-1' }) },
      { upsert: true },
    );
    expect(equipmentValidationService.mergeAndRevalidate).toHaveBeenCalledWith({ equipment: ['Slide'] }, playgroundId);
    expect(equipmentValidationService.rerankGallery).toHaveBeenCalledWith(playgroundId);
    expect(updatePhoto).toHaveBeenCalledWith(
      { _id: photoId },
      { $set: expect.objectContaining({ status: 'AUTO_APPROVED', finalObjectPath: 'public-64f1a9f7c2a7d9b123456789.jpeg' }) },
    );
  });

  test('processPhoto creates moderation queue records and sends admin email for reviewable photos', async () => {
    const photoId = new ObjectId('64f1a9f7c2a7d9b123456781');
    const playgroundId = new ObjectId('64f1a9f7c2a7d9b123456782');
    const insertQueue = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      photo_uploads: {
        findOne: jest.fn().mockResolvedValue({
          _id: photoId,
          tempObjectPath: 'quarantine/original-photo.jpg',
          adultTermsAccepted: true,
        }),
        updateOne: jest.fn().mockResolvedValue({}),
      },
      users: {
        findOne: jest.fn().mockResolvedValue(null),
      },
      playgrounds: {
        findOne: jest.fn().mockResolvedValue({
          _id: playgroundId,
          name: 'Review Park',
          types: ['park'],
        }),
      },
      moderation_queue: { insertOne: insertQueue },
    }));
    moderatePhoto.mockResolvedValue({
      status: 'NEEDS_ADMIN_REVIEW',
      processedBuffer: Buffer.from('masked'),
      peopleDetected: true,
      faceCount: 1,
      actionTaken: 'STICKER_MASK',
      reason: 'Low confidence',
      geminiSummary: { confidence: 0.5 },
      moderationFlags: ['NEEDS_ADMIN_REVIEW'],
    });

    await expect(processPhoto(photoId.toHexString(), playgroundId, 'user-2')).resolves.toEqual({
      status: 'NEEDS_ADMIN_REVIEW',
      url: 'https://storage.googleapis.com/playground_app_bucket/public-64f1a9f7c2a7d9b123456781.jpeg',
      reason: 'Low confidence',
    });

    expect(insertQueue).toHaveBeenCalledWith(expect.objectContaining({
      submissionId: photoId.toHexString(),
      submissionType: 'PHOTO',
      playgroundId,
      playgroundName: 'Review Park',
      status: 'NEEDS_ADMIN_REVIEW',
      previewUrl: 'https://storage.googleapis.com/playground_app_bucket/public-64f1a9f7c2a7d9b123456781.jpeg',
      originalTempObjectPath: 'quarantine/original-photo.jpg',
      sanitizedObjectPath: 'public-64f1a9f7c2a7d9b123456781.jpeg',
      adultTermsAccepted: true,
    }));
    expect(sendAdminNotificationEmail).toHaveBeenCalledWith(
      'New Photo for Moderation: Review Park',
      expect.stringContaining('Low confidence'),
      expect.stringContaining('<b>New Photo for Moderation: Review Park</b>'),
    );
    expect(contributionService.recordContribution).not.toHaveBeenCalled();
  });

  test('processPhoto marks the record failed and throws when quarantine download fails', async () => {
    const photoId = new ObjectId('64f1a9f7c2a7d9b123456783');
    const updatePhoto = jest.fn().mockResolvedValue({});
    mockFile.download.mockRejectedValueOnce(new Error('missing object'));
    getDb.mockReturnValue(makeDb({
      photo_uploads: {
        findOne: jest.fn().mockResolvedValue({
          _id: photoId,
          tempObjectPath: 'quarantine/missing.jpg',
        }),
        updateOne: updatePhoto,
      },
    }));

    await expect(processPhoto(photoId.toHexString(), '64f1a9f7c2a7d9b123456784', 'user-3'))
      .rejects.toThrow('Failed to download original image for processing.');

    expect(updatePhoto).toHaveBeenCalledWith(
      { _id: photoId },
      { $set: { status: 'FAILED', reason: 'Failed to download original.', processedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(moderatePhoto).not.toHaveBeenCalled();
  });
});
