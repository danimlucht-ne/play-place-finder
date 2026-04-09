jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendEmail: jest.fn() }));

const { getDb } = require('../database');
const { sendEmail } = require('../services/notificationService');
const { buildEmail, notifyAdvertiser } = require('../services/advertiserEmailService');

describe('advertiserEmailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('builds payment receipt emails with amount and calendar start date', () => {
    const email = buildEmail(
      'campaign_payment_received',
      { amountInCents: 1299, startDateCalendar: '2026-04-15' },
      { businessName: 'Tiny Gym' },
    );

    expect(email.subject).toBe('We received your PlayPlace Finder ad payment');
    expect(email.text).toContain('Hi Tiny Gym');
    expect(email.text).toContain('$12.99');
    expect(email.text).toContain('April 15, 2026');
  });

  test('prefers creative headline in greeting when adDisplayName is provided', () => {
    const email = buildEmail(
      'campaign_now_live',
      { adDisplayName: 'Spring Open Gym' },
      { businessName: 'Temp Ad' },
    );
    expect(email.text).toContain('Hi Spring Open Gym');
    expect(email.text).not.toContain('Hi Temp Ad');
  });

  test('builds rejection and cancellation copy with policy details', () => {
    const rejected = buildEmail(
      'campaign_rejected',
      { reason: 'Image is too blurry' },
      { businessName: 'Kids Cafe' },
    );
    const refunded = buildEmail(
      'campaign_cancelled',
      { refundAmount: 2500 },
      { businessName: 'Kids Cafe' },
    );
    const notRefunded = buildEmail('campaign_cancelled', {}, { businessName: 'Kids Cafe' });

    expect(rejected.text).toContain('Reason: Image is too blurry');
    expect(rejected.text).toContain('A full refund has been issued');
    expect(refunded.text).toContain('$25.00');
    expect(notRefunded.text).toContain('do not include a refund');
  });

  test('unknown templates return an empty email and are not sent', async () => {
    const findOne = jest.fn().mockResolvedValue({
      _id: 'adv-1',
      businessName: 'Unknown Template Shop',
      contactEmail: 'ads@test.invalid',
    });
    getDb.mockReturnValue({ collection: jest.fn(() => ({ findOne })) });

    expect(buildEmail('missing_template', {}, {})).toEqual({ subject: '', text: '' });
    await notifyAdvertiser('adv-1', 'missing_template');

    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('sends a known template to the advertiser contact email', async () => {
    const findOne = jest.fn().mockResolvedValue({
      _id: 'adv-1',
      businessName: 'Play Cafe',
      contactEmail: 'owner@test.invalid',
    });
    getDb.mockReturnValue({ collection: jest.fn(() => ({ findOne })) });

    await notifyAdvertiser('adv-1', 'campaign_now_live', {});

    expect(findOne).toHaveBeenCalledWith({ _id: 'adv-1' });
    expect(sendEmail).toHaveBeenCalledWith(
      'owner@test.invalid',
      'Your PlayPlace Finder ad is live!',
      expect.stringContaining('Play Cafe'),
    );
  });

  test('returns silently when advertiser is missing or has no contact email', async () => {
    const findOne = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'adv-2', businessName: 'No Email' });
    getDb.mockReturnValue({ collection: jest.fn(() => ({ findOne })) });

    await notifyAdvertiser('adv-missing', 'campaign_now_live', {});
    await notifyAdvertiser('adv-2', 'campaign_now_live', {});

    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('logs and swallows email transport failures', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const findOne = jest.fn().mockResolvedValue({
      _id: 'adv-1',
      businessName: 'Play Cafe',
      contactEmail: 'owner@test.invalid',
    });
    getDb.mockReturnValue({ collection: jest.fn(() => ({ findOne })) });
    sendEmail.mockRejectedValue(new Error('SMTP down'));

    await expect(notifyAdvertiser('adv-1', 'campaign_now_live', {})).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      '[advertiserEmail] Failed to send campaign_now_live to owner@test.invalid:',
      'SMTP down',
    );
    errorSpy.mockRestore();
  });
});
