/**
 * Tracks per-user moderation outcomes (approved vs rejected) for edits, photos, and new listings.
 * Used for analytics and optional automatic block after repeated rejections.
 */
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');

/** Maps queue submissionType → users.moderationStats.<key> */
const TYPE_TO_BUCKET = {
  PHOTO: 'photos',
  PLAYGROUND_EDIT: 'edits',
  NEW_PLAYGROUND: 'newPlaygrounds',
};

/**
 * @param {import('mongodb').Document} queueItem
 * @returns {Promise<string|null>} Firebase uid
 */
async function resolveUserId(db, queueItem) {
  if (queueItem.submittedByUserId) return queueItem.submittedByUserId;
  if (queueItem.requestedBy) return queueItem.requestedBy;
  if (queueItem.submissionType === 'PHOTO' && queueItem.submissionId) {
    try {
      const pr = await db.collection('photo_uploads').findOne({ _id: new ObjectId(queueItem.submissionId) });
      return pr?.uploadedBy || null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function thresholdRejectionTypes() {
  const types = ['PHOTO', 'PLAYGROUND_EDIT'];
  if (process.env.MODERATION_AUTO_BLOCK_INCLUDE_NEW_PLAYGROUNDS === 'true') {
    types.push('NEW_PLAYGROUND');
  }
  return types;
}

/**
 * @param {import('mongodb').Document} queueItem  Raw moderation_queue document
 * @param {'approved'|'rejected'} outcome
 */
async function recordOutcomeFromQueueItem(queueItem, outcome) {
  if (!queueItem || (outcome !== 'approved' && outcome !== 'rejected')) return;

  const db = getDb();
  const userId = await resolveUserId(db, queueItem);
  if (!userId) return;

  const bucket = TYPE_TO_BUCKET[queueItem.submissionType];
  if (!bucket) return;

  const incField = outcome === 'approved' ? `moderationStats.${bucket}.approved` : `moderationStats.${bucket}.rejected`;

  try {
    await db.collection('users').updateOne({ _id: userId }, { $inc: { [incField]: 1 } });
  } catch (err) {
    console.warn('[moderationStats] user increment failed:', err.message);
  }

  try {
    await db.collection('moderation_outcomes').insertOne({
      userId,
      submissionType: queueItem.submissionType,
      outcome,
      queueItemId: queueItem._id,
      createdAt: new Date(),
    });
  } catch (err) {
    console.warn('[moderationStats] outcome log insert failed:', err.message);
  }

  if (outcome === 'rejected') {
    await maybeAutoBlockAfterRejection(userId, db);
  }
}

async function maybeAutoBlockAfterRejection(userId, db) {
  const threshold = parseInt(process.env.MODERATION_AUTO_BLOCK_REJECTION_COUNT || '0', 10);
  if (!Number.isFinite(threshold) || threshold <= 0) return;

  const windowDays = parseInt(process.env.MODERATION_REJECTION_WINDOW_DAYS || '90', 10);
  const since = new Date(Date.now() - windowDays * 86400000);
  const types = thresholdRejectionTypes();

  let n;
  try {
    n = await db.collection('moderation_outcomes').countDocuments({
      userId,
      outcome: 'rejected',
      submissionType: { $in: types },
      createdAt: { $gte: since },
    });
  } catch (err) {
    console.warn('[moderationStats] rejection count failed:', err.message);
    return;
  }

  if (n < threshold) return;

  const user = await db.collection('users').findOne(
    { _id: userId },
    { projection: { blockedAt: 1, bannedAt: 1 } },
  );
  if (!user || user.bannedAt || user.blockedAt) return;

  const reason = `Automatic block: ${n} rejected photo/edit submissions in the last ${windowDays} days (threshold: ${threshold}).`;

  try {
    await db.collection('users').updateOne(
      { _id: userId },
      {
        $set: {
          blockedAt: new Date(),
          blockedReason: reason,
          blockedBy: 'system:auto-moderation',
        },
      },
    );
    await db.collection('user_notifications').insertOne({
      userId,
      message:
        'Your account was temporarily blocked from new submissions after repeated moderation rejections. Contact support if you believe this is a mistake.',
      read: false,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('[moderationStats] auto-block failed:', err.message);
  }
}

/**
 * Summary for admin dashboards: rolling rejection count + user counters.
 */
async function getModerationSummaryForUser(userId) {
  const db = getDb();
  const windowDays = parseInt(process.env.MODERATION_REJECTION_WINDOW_DAYS || '90', 10);
  const since = new Date(Date.now() - windowDays * 86400000);
  const types = thresholdRejectionTypes();

  const [user, rejectionsInWindow] = await Promise.all([
    db.collection('users').findOne({ _id: userId }, { projection: { moderationStats: 1, blockedAt: 1, blockedReason: 1 } }),
    db.collection('moderation_outcomes').countDocuments({
      userId,
      outcome: 'rejected',
      submissionType: { $in: types },
      createdAt: { $gte: since },
    }),
  ]);

  return {
    moderationStats: user?.moderationStats || null,
    rejectionsInWindow,
    windowDays,
    typesCounted: types,
    autoBlockThreshold: parseInt(process.env.MODERATION_AUTO_BLOCK_REJECTION_COUNT || '0', 10) || null,
    blockedAt: user?.blockedAt || null,
    blockedReason: user?.blockedReason || null,
  };
}

module.exports = {
  recordOutcomeFromQueueItem,
  resolveUserId,
  getModerationSummaryForUser,
};
