jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/advertiserEmailService', () => ({
  notifyAdvertiser: jest.fn(),
  resolveAdDisplayName: jest.fn().mockResolvedValue(''),
}));

const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const { notifyAdvertiser } = require('../services/advertiserEmailService');
const {
  notifyPaymentCapturedIfNeeded,
  notifyCampaignNowLiveIfNeeded,
  notifyCampaignLifecycleAfterActivation,
} = require('../services/adCampaignEmailTriggers');

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

describe('adCampaignEmailTriggers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not send payment receipt when submission is missing, already sent, or unpaid', async () => {
    const submissionId = new ObjectId();
    const submissionFindOne = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: submissionId, paymentCapturedEmailSent: true })
      .mockResolvedValueOnce({ _id: submissionId, advertiserId: 'adv-1' });
    const transactionFindOne = jest.fn().mockResolvedValue(null);
    const updateOne = jest.fn();
    getDb.mockReturnValue(makeDb({
      adSubmissions: { findOne: submissionFindOne, updateOne },
      paymentTransactions: { findOne: transactionFindOne },
    }));

    await notifyPaymentCapturedIfNeeded(submissionId);
    await notifyPaymentCapturedIfNeeded(submissionId);
    await notifyPaymentCapturedIfNeeded(submissionId);

    expect(notifyAdvertiser).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('sends payment receipt once a positive successful transaction exists', async () => {
    const submissionId = new ObjectId();
    const startDate = new Date('2026-04-15T00:00:00Z');
    const updateOne = jest.fn();
    getDb.mockReturnValue(makeDb({
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          advertiserId: 'adv-1',
          startDate,
          startDateCalendar: '2026-04-15',
        }),
        updateOne,
      },
      paymentTransactions: {
        findOne: jest.fn().mockResolvedValue({ amountInCents: 1500, status: 'succeeded' }),
      },
    }));

    await notifyPaymentCapturedIfNeeded(submissionId.toHexString());

    expect(notifyAdvertiser).toHaveBeenCalledWith('adv-1', 'campaign_payment_received', {
      amountInCents: 1500,
      startDate,
      startDateCalendar: '2026-04-15',
      adDisplayName: '',
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: submissionId, paymentCapturedEmailSent: { $ne: true } },
      { $set: { paymentCapturedEmailSent: true, updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
  });

  test('sends live campaign email only for active unsent campaigns', async () => {
    const campaignId = new ObjectId();
    const updateOne = jest.fn();
    const campaignFindOne = jest.fn()
      .mockResolvedValueOnce({ _id: campaignId, advertiserId: 'adv-1', status: 'paused' })
      .mockResolvedValueOnce({ _id: campaignId, advertiserId: 'adv-1', status: 'active', campaignLiveEmailSent: true })
      .mockResolvedValueOnce({
        _id: campaignId,
        advertiserId: 'adv-1',
        status: 'active',
        endDateCalendar: '2026-05-01',
        startDateCalendar: '2026-04-15',
      });
    getDb.mockReturnValue(makeDb({ adCampaigns: { findOne: campaignFindOne, updateOne } }));

    await notifyCampaignNowLiveIfNeeded(campaignId);
    await notifyCampaignNowLiveIfNeeded(campaignId);
    await notifyCampaignNowLiveIfNeeded(campaignId);

    expect(notifyAdvertiser).toHaveBeenCalledTimes(1);
    expect(notifyAdvertiser).toHaveBeenCalledWith('adv-1', 'campaign_now_live', {
      endDate: undefined,
      endDateCalendar: '2026-05-01',
      startDateCalendar: '2026-04-15',
      adDisplayName: '',
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: campaignId, campaignLiveEmailSent: { $ne: true } },
      { $set: { campaignLiveEmailSent: true, updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
  });

  test('sends scheduled approval during lifecycle activation when campaign is scheduled', async () => {
    const submissionId = new ObjectId();
    const campaignId = new ObjectId();
    const updateOne = jest.fn();
    getDb.mockReturnValue(makeDb({
      adSubmissions: { findOne: jest.fn().mockResolvedValue({ _id: submissionId, advertiserId: 'adv-1' }) },
      adCampaigns: {
        findOne: jest.fn().mockResolvedValue({
          _id: campaignId,
          submissionId,
          status: 'scheduled',
          startDateCalendar: '2026-04-20',
        }),
        updateOne,
      },
    }));

    await notifyCampaignLifecycleAfterActivation(submissionId);

    expect(notifyAdvertiser).toHaveBeenCalledWith('adv-1', 'campaign_scheduled_approved', {
      startDate: undefined,
      startDateCalendar: '2026-04-20',
      adDisplayName: '',
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: campaignId, scheduledApprovalEmailSent: { $ne: true } },
      { $set: { scheduledApprovalEmailSent: true, updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
  });
});
