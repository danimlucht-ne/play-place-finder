const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const { notifyAdvertiser, resolveAdDisplayName } = require('./advertiserEmailService');

/**
 * @param {import('mongodb').ObjectId|string} submissionId
 * @returns {import('mongodb').ObjectId}
 */
function toOid(submissionId) {
  if (submissionId instanceof ObjectId) return submissionId;
  if (typeof submissionId === 'string' && ObjectId.isValid(submissionId)) return new ObjectId(submissionId);
  return submissionId;
}

/**
 * After a real charge (amount &gt; 0) succeeds. Idempotent via adSubmissions.paymentCapturedEmailSent.
 * @param {import('mongodb').ObjectId|string} submissionId
 */
async function notifyPaymentCapturedIfNeeded(submissionId) {
  const db = getDb();
  const sid = toOid(submissionId);
  const submission = await db.collection('adSubmissions').findOne({ _id: sid });
  if (!submission || submission.paymentCapturedEmailSent) return;

  const paid = await db.collection('paymentTransactions').findOne({
    submissionId: sid,
    status: 'succeeded',
    amountInCents: { $gt: 0 },
  });
  if (!paid) return;

  const adDisplayName = await resolveAdDisplayName(db, submission.creativeId);
  await notifyAdvertiser(submission.advertiserId, 'campaign_payment_received', {
    amountInCents: paid.amountInCents,
    startDate: submission.startDate,
    startDateCalendar: submission.startDateCalendar,
    adDisplayName,
  });

  await db.collection('adSubmissions').updateOne(
    { _id: sid, paymentCapturedEmailSent: { $ne: true } },
    { $set: { paymentCapturedEmailSent: true, updatedAt: new Date() } }
  );
}

/**
 * Sends campaign_now_live when status is active and flag not set.
 * @param {import('mongodb').ObjectId} campaignId
 */
async function notifyCampaignNowLiveIfNeeded(campaignId) {
  const db = getDb();
  const campaign = await db.collection('adCampaigns').findOne({ _id: campaignId });
  if (!campaign || campaign.status !== 'active' || campaign.campaignLiveEmailSent) return;

  const adDisplayName = await resolveAdDisplayName(db, campaign.creativeId);
  await notifyAdvertiser(campaign.advertiserId, 'campaign_now_live', {
    endDate: campaign.endDate,
    endDateCalendar: campaign.endDateCalendar,
    startDateCalendar: campaign.startDateCalendar,
    adDisplayName,
  });

  await db.collection('adCampaigns').updateOne(
    { _id: campaign._id, campaignLiveEmailSent: { $ne: true } },
    { $set: { campaignLiveEmailSent: true, updatedAt: new Date() } }
  );
}

/**
 * After activateCampaign (new or pending_review → scheduled/active). Sends scheduled vs live once each.
 * @param {import('mongodb').ObjectId|string} submissionId
 */
async function notifyCampaignLifecycleAfterActivation(submissionId) {
  const db = getDb();
  const sid = toOid(submissionId);
  const submission = await db.collection('adSubmissions').findOne({ _id: sid });
  const campaign = await db.collection('adCampaigns').findOne({ submissionId: sid });
  if (!submission || !campaign) return;

  if (campaign.status === 'active') {
    await notifyCampaignNowLiveIfNeeded(campaign._id);
    return;
  }

  if (campaign.status === 'scheduled' && !campaign.scheduledApprovalEmailSent) {
    const adDisplayName = await resolveAdDisplayName(db, submission.creativeId);
    await notifyAdvertiser(submission.advertiserId, 'campaign_scheduled_approved', {
      startDate: campaign.startDate,
      startDateCalendar: campaign.startDateCalendar,
      adDisplayName,
    });
    await db.collection('adCampaigns').updateOne(
      { _id: campaign._id, scheduledApprovalEmailSent: { $ne: true } },
      { $set: { scheduledApprovalEmailSent: true, updatedAt: new Date() } }
    );
  }
}

module.exports = {
  notifyPaymentCapturedIfNeeded,
  notifyCampaignNowLiveIfNeeded,
  notifyCampaignLifecycleAfterActivation,
};
