jest.mock('../database', () => ({ getDb: jest.fn() }));

const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const {
  resolveUserId,
  recordOutcomeFromQueueItem,
  getModerationSummaryForUser,
} = require('../services/moderationStatsService');

describe('moderationStatsService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = originalEnv;
  });

  test('resolves user id from queue fields and photo upload fallback', async () => {
    expect(await resolveUserId({}, { submittedByUserId: 'user-a' })).toBe('user-a');
    expect(await resolveUserId({}, { requestedBy: 'user-b' })).toBe('user-b');

    const findOne = jest.fn().mockResolvedValue({ uploadedBy: 'photo-user' });
    const db = { collection: jest.fn(() => ({ findOne })) };
    const submissionId = new ObjectId().toHexString();
    await expect(resolveUserId(db, { submissionType: 'PHOTO', submissionId })).resolves.toBe('photo-user');
    expect(findOne).toHaveBeenCalledWith({ _id: new ObjectId(submissionId) });

    await expect(resolveUserId(db, { submissionType: 'PHOTO', submissionId: 'bad-id' })).resolves.toBeNull();
  });

  test('records approved outcome counters and log rows', async () => {
    const usersUpdateOne = jest.fn().mockResolvedValue({});
    const outcomesInsertOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn((name) => {
      if (name === 'users') return { updateOne: usersUpdateOne };
      if (name === 'moderation_outcomes') return { insertOne: outcomesInsertOne };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await recordOutcomeFromQueueItem(
      { _id: 'queue-1', submittedByUserId: 'user-1', submissionType: 'PLAYGROUND_EDIT' },
      'approved',
    );

    expect(usersUpdateOne).toHaveBeenCalledWith(
      { _id: 'user-1' },
      { $inc: { 'moderationStats.edits.approved': 1 } },
    );
    expect(outcomesInsertOne).toHaveBeenCalledWith({
      userId: 'user-1',
      submissionType: 'PLAYGROUND_EDIT',
      outcome: 'approved',
      queueItemId: 'queue-1',
      createdAt: new Date('2026-04-09T12:00:00Z'),
    });
  });

  test('auto-blocks after rejected threshold is reached', async () => {
    process.env.MODERATION_AUTO_BLOCK_REJECTION_COUNT = '2';
    process.env.MODERATION_REJECTION_WINDOW_DAYS = '30';

    const usersUpdateOne = jest.fn().mockResolvedValue({});
    const usersFindOne = jest.fn().mockResolvedValue({ _id: 'user-1' });
    const outcomesInsertOne = jest.fn().mockResolvedValue({});
    const countDocuments = jest.fn().mockResolvedValue(2);
    const notificationsInsertOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn((name) => {
      if (name === 'users') return { updateOne: usersUpdateOne, findOne: usersFindOne };
      if (name === 'moderation_outcomes') return { insertOne: outcomesInsertOne, countDocuments };
      if (name === 'user_notifications') return { insertOne: notificationsInsertOne };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await recordOutcomeFromQueueItem(
      { _id: 'queue-1', submittedByUserId: 'user-1', submissionType: 'PHOTO' },
      'rejected',
    );

    expect(usersUpdateOne).toHaveBeenCalledWith(
      { _id: 'user-1' },
      { $inc: { 'moderationStats.photos.rejected': 1 } },
    );
    expect(usersUpdateOne).toHaveBeenCalledWith(
      { _id: 'user-1' },
      {
        $set: {
          blockedAt: new Date('2026-04-09T12:00:00Z'),
          blockedReason: expect.stringContaining('Automatic block: 2 rejected'),
          blockedBy: 'system:auto-moderation',
        },
      },
    );
    expect(notificationsInsertOne).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      read: false,
      createdAt: new Date('2026-04-09T12:00:00Z'),
    }));
  });

  test('returns moderation summary with env-controlled counted types', async () => {
    process.env.MODERATION_AUTO_BLOCK_INCLUDE_NEW_PLAYGROUNDS = 'true';
    process.env.MODERATION_AUTO_BLOCK_REJECTION_COUNT = '5';
    process.env.MODERATION_REJECTION_WINDOW_DAYS = '45';

    const usersFindOne = jest.fn().mockResolvedValue({
      moderationStats: { photos: { rejected: 2 } },
      blockedAt: new Date('2026-04-01T00:00:00Z'),
      blockedReason: 'reason',
    });
    const countDocuments = jest.fn().mockResolvedValue(4);
    const collection = jest.fn((name) => {
      if (name === 'users') return { findOne: usersFindOne };
      if (name === 'moderation_outcomes') return { countDocuments };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await expect(getModerationSummaryForUser('user-1')).resolves.toMatchObject({
      moderationStats: { photos: { rejected: 2 } },
      rejectionsInWindow: 4,
      windowDays: 45,
      typesCounted: ['PHOTO', 'PLAYGROUND_EDIT', 'NEW_PLAYGROUND'],
      autoBlockThreshold: 5,
      blockedReason: 'reason',
    });
  });
});
