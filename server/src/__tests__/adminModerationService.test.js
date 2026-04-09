jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/contributionService', () => ({ recordContribution: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendAdminNotificationEmail: jest.fn() }));
jest.mock('../services/badgeService', () => ({ computeBadges: jest.fn() }));
jest.mock('../services/equipmentValidationService', () => ({
  computePhotoScore: jest.fn(),
  mergeAndRevalidate: jest.fn(),
  rerankGallery: jest.fn(),
}));
jest.mock('../services/moderationStatsService', () => ({
  recordOutcomeFromQueueItem: jest.fn(),
}));

const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const contributionService = require('../services/contributionService');
const { computeBadges } = require('../services/badgeService');
const equipmentValidationService = require('../services/equipmentValidationService');
const moderationStatsService = require('../services/moderationStatsService');
const {
  AdminDecision,
  ModerationStatus,
  SubmissionType,
  approve,
  getQueue,
  getQueueItem,
  reject,
  retry,
} = require('../services/adminModerationService');

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

function cursor(items) {
  return { toArray: jest.fn().mockResolvedValue(items) };
}

describe('adminModerationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
    computeBadges.mockReturnValue(['photo-rich']);
    equipmentValidationService.computePhotoScore.mockReturnValue(0.91);
    equipmentValidationService.mergeAndRevalidate.mockResolvedValue({});
    equipmentValidationService.rerankGallery.mockResolvedValue({});
    moderationStatsService.recordOutcomeFromQueueItem.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('getQueue and getQueueItem aggregate moderation records with populated detail fields', async () => {
    const aggregate = jest.fn()
      .mockReturnValueOnce(cursor([{ id: 'q-1', status: 'NEEDS_ADMIN_REVIEW' }]))
      .mockReturnValueOnce(cursor([{ id: 'q-2', playgroundName: 'Elm Park' }]));
    getDb.mockReturnValue(makeDb({
      moderation_queue: { aggregate },
    }));

    await expect(getQueue()).resolves.toEqual([{ id: 'q-1', status: 'NEEDS_ADMIN_REVIEW' }]);
    const firstPipeline = aggregate.mock.calls[0][0];
    expect(firstPipeline[0]).toEqual({ $match: { status: ModerationStatus.NEEDS_ADMIN_REVIEW } });
    expect(firstPipeline[2].$unwind.path).toBe('$submissionDetails');
    expect(firstPipeline[4].$unwind.path).toBe('$playgroundDetails');

    const queueId = new ObjectId('64f1a9f7c2a7d9b123456789').toHexString();
    await expect(getQueueItem(queueId)).resolves.toEqual({ id: 'q-2', playgroundName: 'Elm Park' });
    expect(aggregate.mock.calls[1][0][0]).toEqual({ $match: { _id: new ObjectId(queueId) } });
  });

  test('approve archives delete requests and records moderation history', async () => {
    const queueId = new ObjectId('64f1a9f7c2a7d9b123456701').toHexString();
    const queueItem = {
      _id: new ObjectId(queueId),
      status: ModerationStatus.NEEDS_ADMIN_REVIEW,
      submissionType: SubmissionType.DELETE_REQUEST,
      playgroundId: 'pg-1',
    };
    const updatePlayground = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const updateQueue = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      moderation_queue: {
        findOne: jest.fn().mockResolvedValue(queueItem),
        updateOne: updateQueue,
      },
      playgrounds: { updateOne: updatePlayground },
    }));

    await expect(approve(queueId, 'admin-1')).resolves.toEqual({ success: true });

    expect(updatePlayground).toHaveBeenCalledWith(
      { _id: 'pg-1', archivedAt: { $exists: false } },
      { $set: { archivedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(updateQueue).toHaveBeenCalledWith(
      { _id: new ObjectId(queueId) },
      {
        $set: expect.objectContaining({
          status: ModerationStatus.APPROVED,
          adminDecision: AdminDecision.APPROVE,
          reviewedBy: 'admin-1',
        }),
        $push: { moderationHistory: expect.objectContaining({ action: AdminDecision.APPROVE }) },
      },
    );
    expect(moderationStatsService.recordOutcomeFromQueueItem).toHaveBeenCalledWith(queueItem, 'approved');
  });

  test('reject leaves delete-request playgrounds published and stores the reason', async () => {
    const queueId = new ObjectId('64f1a9f7c2a7d9b123456702').toHexString();
    const queueItem = {
      _id: new ObjectId(queueId),
      status: ModerationStatus.NEEDS_ADMIN_REVIEW,
      submissionType: SubmissionType.DELETE_REQUEST,
      playgroundId: 'pg-1',
    };
    const updateQueue = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      moderation_queue: {
        findOne: jest.fn().mockResolvedValue(queueItem),
        updateOne: updateQueue,
      },
    }));

    await expect(reject(queueId, 'admin-1', 'Keep it live')).resolves.toEqual({ success: true });

    expect(updateQueue).toHaveBeenCalledWith(
      { _id: new ObjectId(queueId) },
      {
        $set: expect.objectContaining({
          status: ModerationStatus.REJECTED,
          adminDecision: AdminDecision.REJECT,
          decisionReason: 'Keep it live',
        }),
        $push: { moderationHistory: expect.objectContaining({ decisionReason: 'Keep it live' }) },
      },
    );
    expect(moderationStatsService.recordOutcomeFromQueueItem).toHaveBeenCalledWith(queueItem, 'rejected');
  });

  test('approve photo records contribution, recomputes badges, scores photo evidence, and syncs status', async () => {
    const queueId = new ObjectId('64f1a9f7c2a7d9b123456703').toHexString();
    const photoId = new ObjectId('64f1a9f7c2a7d9b123456704');
    const playgroundId = new ObjectId('64f1a9f7c2a7d9b123456705');
    const queueItem = {
      _id: new ObjectId(queueId),
      status: ModerationStatus.NEEDS_ADMIN_REVIEW,
      submissionType: SubmissionType.PHOTO,
      submissionId: photoId,
      playgroundId,
    };
    const photoRecord = {
      _id: photoId,
      uploadedBy: 'user-1',
      playgroundId,
      finalUrl: 'https://cdn.example/photo.jpg',
      faceCount: 1,
      actionTaken: 'STICKER_MASK',
      geminiSummary: {
        detectedFeatures: { equipment: ['Slide'] },
      },
    };
    const queueUpdate = jest.fn().mockResolvedValue({});
    const photoUpdate = jest.fn().mockResolvedValue({});
    const playgroundUpdate = jest.fn().mockResolvedValue({});
    const scoreUpdate = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      moderation_queue: {
        findOne: jest.fn()
          .mockResolvedValueOnce(queueItem)
          .mockResolvedValueOnce(queueItem),
        updateOne: queueUpdate,
      },
      photo_uploads: {
        updateOne: photoUpdate,
        findOne: jest.fn().mockResolvedValue(photoRecord),
        countDocuments: jest.fn().mockResolvedValue(4),
      },
      playgrounds: {
        findOne: jest.fn().mockResolvedValue({
          _id: playgroundId,
          name: 'Elm Park',
          city: 'Omaha',
        }),
        updateOne: playgroundUpdate,
      },
      photo_scores: { updateOne: scoreUpdate },
    }));

    await expect(approve(queueId, 'admin-1')).resolves.toEqual({ success: true });

    expect(queueUpdate).toHaveBeenCalledWith(
      { _id: new ObjectId(queueId) },
      expect.objectContaining({
        $set: expect.objectContaining({ status: ModerationStatus.APPROVED, adminDecision: AdminDecision.APPROVE }),
        $push: { moderationHistory: expect.objectContaining({ action: AdminDecision.APPROVE }) },
      }),
    );
    expect(photoUpdate).toHaveBeenCalledWith(
      { _id: photoId },
      { $set: { status: ModerationStatus.APPROVED, reason: null } },
    );
    expect(contributionService.recordContribution).toHaveBeenCalledWith('user-1', SubmissionType.PHOTO, photoId.toHexString(), 'Omaha');
    expect(computeBadges).toHaveBeenCalledWith(expect.objectContaining({ approvedPhotoCount: 4 }));
    expect(playgroundUpdate).toHaveBeenCalledWith(
      { _id: playgroundId },
      { $set: { badges: ['photo-rich'] } },
    );
    expect(scoreUpdate).toHaveBeenCalledWith(
      { playgroundId, photoUrl: 'https://cdn.example/photo.jpg' },
      { $set: expect.objectContaining({ score: 0.91, hasFaces: true, isMasked: true }) },
      { upsert: true },
    );
    expect(equipmentValidationService.mergeAndRevalidate).toHaveBeenCalledWith({ equipment: ['Slide'] }, playgroundId);
    expect(equipmentValidationService.rerankGallery).toHaveBeenCalledWith(playgroundId);
    expect(moderationStatsService.recordOutcomeFromQueueItem).toHaveBeenCalledWith(queueItem, 'approved');
  });

  test('retry reopens an item, clears review metadata, increments retry count, and syncs underlying status', async () => {
    const queueId = new ObjectId('64f1a9f7c2a7d9b123456706').toHexString();
    const photoId = new ObjectId('64f1a9f7c2a7d9b123456707');
    const queueItem = {
      _id: new ObjectId(queueId),
      status: ModerationStatus.REJECTED,
      submissionType: SubmissionType.PHOTO,
      submissionId: photoId,
    };
    const queueUpdate = jest.fn().mockResolvedValue({});
    const photoUpdate = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      moderation_queue: {
        findOne: jest.fn().mockResolvedValue(queueItem),
        updateOne: queueUpdate,
      },
      photo_uploads: { updateOne: photoUpdate },
    }));

    await expect(retry(queueId, 'admin-1')).resolves.toEqual({ success: true });

    expect(queueUpdate).toHaveBeenCalledWith(
      { _id: new ObjectId(queueId) },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: ModerationStatus.NEEDS_ADMIN_REVIEW,
          adminDecision: AdminDecision.RETRY,
          decisionReason: 'Retried by admin-1',
          reviewedBy: null,
          reviewedAt: null,
        }),
        $push: { moderationHistory: expect.objectContaining({ action: AdminDecision.RETRY }) },
        $inc: { retryCount: 1 },
      }),
    );
    expect(photoUpdate).toHaveBeenCalledWith(
      { _id: photoId },
      { $set: { status: ModerationStatus.NEEDS_ADMIN_REVIEW, reason: 'Retried by admin-1' } },
    );
  });
});
