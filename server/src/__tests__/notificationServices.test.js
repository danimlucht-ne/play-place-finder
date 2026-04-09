jest.mock('../database', () => ({ getDb: jest.fn() }));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const { getDb } = require('../database');
const adminNotificationService = require('../services/adminNotificationService');

describe('notification services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('creates admin dashboard notifications', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const insertOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue({ collection: jest.fn(() => ({ insertOne })) });

    await adminNotificationService.notify('Map ready', 'advertising_city_map_ready', 'omaha-ne');

    expect(insertOne).toHaveBeenCalledWith({
      message: 'Map ready',
      notificationType: 'advertising_city_map_ready',
      regionKey: 'omaha-ne',
      isRead: false,
      createdAt: new Date('2026-04-09T12:00:00Z'),
    });
    expect(logSpy).toHaveBeenCalledWith('Admin notification created: Map ready');
    logSpy.mockRestore();
  });

  test('admin notification failures are logged and swallowed', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const insertOne = jest.fn().mockRejectedValue(new Error('db down'));
    getDb.mockReturnValue({ collection: jest.fn(() => ({ insertOne })) });

    await expect(adminNotificationService.notify('Broken', 'test')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('Failed to create admin notification:', expect.any(Error));
    errorSpy.mockRestore();
  });

  test('email notification service sends admin and user emails through nodemailer', async () => {
    process.env.ADMIN_EMAIL = 'admin@test.invalid';
    process.env.EMAIL_USER = 'sender@test.invalid';
    process.env.EMAIL_PASS = 'secret';
    jest.resetModules();
    const { sendAdminNotificationEmail, sendEmail } = require('../services/notificationService');
    mockSendMail.mockResolvedValue({});

    await sendAdminNotificationEmail('Subject', 'Text', '<p>Html</p>');
    await sendEmail('user@test.invalid', 'Hello', 'Body', '<p>Body</p>');
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'sender@test.invalid',
      to: 'admin@test.invalid',
      subject: 'Subject',
      text: 'Text',
      html: '<p>Html</p>',
    });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'sender@test.invalid',
      to: 'user@test.invalid',
      subject: 'Hello',
      text: 'Body',
      html: '<p>Body</p>',
    });
  });

  test('email notification service skips placeholder example domains', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const blockedDomain = 'example.com';
    const blockedAdminEmail = 'admin@' + blockedDomain;
    const blockedUserEmail = 'user@' + blockedDomain;
    const blockedOwnerEmail = 'owner@' + blockedDomain;
    process.env.ADMIN_EMAIL = blockedAdminEmail;
    process.env.EMAIL_USER = 'sender@test.invalid';
    process.env.EMAIL_PASS = 'secret';
    jest.resetModules();
    const { sendAdminNotificationEmail, sendEmail, isBlockedPlaceholderEmail } = require('../services/notificationService');

    expect(isBlockedPlaceholderEmail(blockedOwnerEmail)).toBe(true);
    expect(isBlockedPlaceholderEmail('owner@test.invalid')).toBe(false);

    await sendAdminNotificationEmail('Subject', 'Text', '<p>Html</p>');
    await sendEmail(blockedUserEmail, 'Hello', 'Body', '<p>Body</p>');

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('Skipped admin notification email to placeholder address: ' + blockedAdminEmail);
    expect(warnSpy).toHaveBeenCalledWith('Skipped email to placeholder address: ' + blockedUserEmail);
    warnSpy.mockRestore();
  });
});
