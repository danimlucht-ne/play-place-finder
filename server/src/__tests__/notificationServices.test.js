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
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.EMAIL_USER = 'sender@example.com';
    process.env.EMAIL_PASS = 'secret';
    jest.resetModules();
    const { sendAdminNotificationEmail, sendEmail } = require('../services/notificationService');
    mockSendMail.mockResolvedValue({});

    await sendAdminNotificationEmail('Subject', 'Text', '<p>Html</p>');
    await sendEmail('user@example.com', 'Hello', 'Body', '<p>Body</p>');
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'sender@example.com',
      to: 'admin@example.com',
      subject: 'Subject',
      text: 'Text',
      html: '<p>Html</p>',
    });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Body',
      html: '<p>Body</p>',
    });
  });
});
