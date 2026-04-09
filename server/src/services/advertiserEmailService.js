const { sendEmail } = require('./notificationService');
const { getDb } = require('../database');

/**
 * @param {import('mongodb').Db} db
 * @param {import('mongodb').ObjectId|undefined|null} creativeId
 * @returns {Promise<string>}
 */
async function resolveAdDisplayName(db, creativeId) {
  if (!creativeId) return '';
  const cr = await db.collection('adCreatives').findOne({ _id: creativeId });
  if (!cr) return '';
  const h = cr.headline != null ? String(cr.headline).trim() : '';
  const b = cr.businessName != null ? String(cr.businessName).trim() : '';
  return h || b || '';
}

const BUSINESS_ENTITY = 'Lucht Applications LLC';
const APP_NAME = 'PlayPlace Finder';

/**
 * Sends a templated email to an advertiser.
 * Returns silently if advertiser not found or has no contactEmail.
 * @param {import('mongodb').ObjectId|string} advertiserId
 * @param {string} templateKey — campaign_payment_received, campaign_now_live, campaign_scheduled_approved, campaign_approved_pending_charge, campaign_approved (legacy), campaign_rejected, campaign_revision_requested, campaign_paused, campaign_cancelled, campaign_expiring_soon, campaign_completed_next_discount, campaign_midpoint_next_discount
 * @param {Object} templateData — extra data for the template (reason, refundAmount, endDate, etc.)
 */
async function notifyAdvertiser(advertiserId, templateKey, templateData = {}) {
  try {
    const db = getDb();
    const advertiser = await db.collection('advertisers').findOne({ _id: advertiserId });
    if (!advertiser || !advertiser.contactEmail) return;

    const { subject, text } = buildEmail(templateKey, templateData, advertiser);
    if (!subject) return;

    try {
      await sendEmail(advertiser.contactEmail, subject, text);
    } catch (err) {
      console.error(`[advertiserEmail] Failed to send ${templateKey} to ${advertiser.contactEmail}:`, err.message);
    }
  } catch (err) {
    console.error(`[advertiserEmail] Error in notifyAdvertiser:`, err.message);
  }
}

/**
 * Builds email subject and body for a given template key.
 * @param {string} templateKey
 * @param {Object} data
 * @param {Object} advertiser
 * @returns {{ subject: string, text: string }}
 */
function buildEmail(templateKey, data, advertiser) {
  const adLine = data.adDisplayName != null ? String(data.adDisplayName).trim() : '';
  const name = adLine || advertiser.businessName || 'Advertiser';

  const amountStr =
    data.amountInCents != null ? (Number(data.amountInCents) / 100).toFixed(2) : null;
  const startLine = (() => {
    if (data.startDateCalendar && /^\d{4}-\d{2}-\d{2}$/.test(String(data.startDateCalendar))) {
      const [y, m, d] = String(data.startDateCalendar).split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    if (data.startDate) {
      return new Date(data.startDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    return null;
  })();

  const templates = {
    campaign_payment_received: {
      subject: `We received your ${APP_NAME} ad payment`,
      text: `Hi ${name},\n\nThank you — we've received your payment${amountStr ? ` of $${amountStr}` : ''} for your ad campaign.${startLine ? `\n\nYour campaign is set to start on ${startLine}.` : ''}\n\nYou can track status and performance from your advertiser dashboard.\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_now_live: {
      subject: `Your ${APP_NAME} ad is live!`,
      text: `Hi ${name},\n\nGreat news — your ad campaign is now live on ${APP_NAME}!\n\nYour ad will be shown to families in your target area. You can track performance from your advertiser dashboard.\n\nThank you for advertising with us!\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_scheduled_approved: {
      subject: `Your ${APP_NAME} ad was approved`,
      text: `Hi ${name},\n\nYour ad campaign has been approved. It will go live on ${startLine || 'your scheduled start date'}.\n\nYou can track status from your advertiser dashboard.\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_approved_pending_charge: {
      subject: `Your ${APP_NAME} ad was approved`,
      text: `Hi ${name},\n\nYour ad campaign has been approved. Payment will be captured when your campaign starts${startLine ? ` (${startLine})` : ''}.\n\nYou'll receive a confirmation when payment is processed and when the campaign goes live.\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_approved: {
      subject: `Your ${APP_NAME} ad is live!`,
      text: `Hi ${name},\n\nGreat news — your ad campaign has been approved and is now live on ${APP_NAME}!\n\nYour ad will be shown to families in your target area. You can track performance from your advertiser dashboard.\n\nThank you for advertising with us!\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_rejected: {
      subject: `Your ${APP_NAME} ad submission update`,
      text: `Hi ${name},\n\nUnfortunately, your ad submission was not approved.${data.reason ? `\n\nReason: ${data.reason}` : ''}\n\nA full refund has been issued to your original payment method. If you have questions, please reach out to our support team.\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_revision_requested: {
      subject: `Action needed: update your ${APP_NAME} ad`,
      text: `Hi ${name},\n\nWe reviewed your ad and need a few changes before it can go live.\n\n${data.message ? `What to fix:\n${data.message}\n\n` : ''}Any uncaptured card authorization has been released. Open the app, edit your creative, and submit again when ready.\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_paused: {
      subject: `Your ${APP_NAME} campaign has been paused`,
      text: `Hi ${name},\n\nYour ad campaign has been paused by an administrator. Your campaign duration will be extended by the paused time once it resumes.\n\nIf you have questions, please contact our support team.\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_cancelled: {
      subject: `Your ${APP_NAME} campaign has been cancelled`,
      text: `Hi ${name},\n\nYour ad campaign has been cancelled.${data.refundAmount ? `\n\nA refund of $${(data.refundAmount / 100).toFixed(2)} has been issued to your original payment method.` : '\n\nPer our advertising terms, advertiser-initiated cancellations do not include a refund for amounts already paid.'}\n\nIf you have questions, please contact our support team.\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_expiring_soon: {
      subject: `Your ${APP_NAME} campaign expires in 3 days`,
      text: `Hi ${name},\n\nThis is a friendly reminder that your ad campaign is set to end on ${data.endDate ? new Date(data.endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'soon'}.\n\nIf you'd like to continue advertising, you can submit a new campaign from your advertiser dashboard.\n\nThank you for advertising with ${APP_NAME}!\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_completed_next_discount: {
      subject: `Thanks for advertising — 20% off your next ${APP_NAME} campaign`,
      text: `Hi ${name},\n\nYour recent ad campaign has ended. Thank you for advertising with ${APP_NAME}!\n\nAs a thank-you, here is a one-time discount code for 20% off your next campaign (any package):\n\n  ${data.code || 'CODE'}\n\nEnter this code at checkout. It expires on ${data.endDate ? new Date(data.endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'the date shown in your account'} and can be used once.\n\n${BUSINESS_ENTITY}\n${APP_NAME}`,
    },
    campaign_midpoint_next_discount: {
      subject: `You're halfway through your ${APP_NAME} campaign — 20% off your next booking`,
      text: (() => {
        const endPhrase = data.campaignEndDate
          ? ` (scheduled through ${new Date(data.campaignEndDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })})`
          : '';
        const codeExpiry = data.endDate
          ? new Date(data.endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : 'the date shown in this email';
        return `Hi ${name},\n\nYou're about halfway through your current ad campaign${endPhrase}. If you'd like to line up your next run early, here is a one-time 20% discount code for your next campaign (any package):\n\n  ${data.code || 'CODE'}\n\nEnter this code at checkout. The code itself expires on ${codeExpiry} and can be used once.\n\n${BUSINESS_ENTITY}\n${APP_NAME}`;
      })(),
    },
  };

  return templates[templateKey] || { subject: '', text: '' };
}

module.exports = { notifyAdvertiser, buildEmail, resolveAdDisplayName };
