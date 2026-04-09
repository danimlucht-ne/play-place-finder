const { verificationEmail, passwordResetEmail } = require('../templates/authEmails');

describe('auth email templates', () => {
  test('verification email includes branding, action link, and fallback text', () => {
    const link = 'https://example.com/verify?token=abc';
    const email = verificationEmail(link);

    expect(email.html).toContain('Confirm your email');
    expect(email.html).toContain('Play Place Finder');
    expect(email.html).toContain(link);
    expect(email.text).toContain('Confirm your email');
    expect(email.text).toContain(link);
    expect(email.text).toContain('ignore this email');
  });

  test('password reset email includes reset copy and does not claim account creation', () => {
    const link = 'https://example.com/reset?token=abc';
    const email = passwordResetEmail(link);

    expect(email.html).toContain('Reset your password');
    expect(email.html).toContain('Reset password');
    expect(email.html).toContain(link);
    expect(email.text).toContain('Reset your password');
    expect(email.text).toContain('set a new password');
    expect(email.text).not.toContain('Thanks for signing up');
  });
});
