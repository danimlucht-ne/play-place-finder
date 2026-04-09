/**
 * HTML + plain-text bodies for auth emails (Nodemailer). Inline CSS for email clients.
 * To change branding, edit styles here once — used for verify + password reset.
 */

const BRAND = 'Play Place Finder';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'playplacefinder@gmail.com';
const SUPPORT_TEXT = `Need help? Reply to this email or contact ${SUPPORT_EMAIL}.`;
const TEAL = '#00838f';
const TEAL_DARK = '#006064';
const BG = '#f0f4f4';

function wrapHtml({ title, lead, buttonLabel, actionUrl, footerNote }) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="padding:32px 36px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${TEAL};">${BRAND}</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${TEAL_DARK};font-weight:700;">${title}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.55;color:#424242;">${lead}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
<tr><td style="border-radius:10px;background:${TEAL};">
<a href="${actionUrl}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${buttonLabel}</a>
</td></tr></table>
<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#757575;">If the button doesn’t work, copy this link into your browser:</p>
<p style="margin:0 0 24px;font-size:12px;line-height:1.4;word-break:break-all;color:${TEAL};">${actionUrl}</p>
<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#616161;">${SUPPORT_TEXT}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#9e9e9e;">${footerNote}</p>
</td></tr></table>
<p style="margin:24px 0 0;font-size:11px;color:#9e9e9e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">You’re receiving this because someone used this address with ${BRAND}.</p>
</td></tr></table>
</body></html>`;
}

function verificationEmail(link) {
    const html = wrapHtml({
        title: 'Confirm your email',
        lead: 'Thanks for signing up. Tap the button below to verify your email address and finish setting up your account.',
        buttonLabel: 'Verify email',
        actionUrl: link,
        footerNote: 'This link expires after a while. If you didn’t create an account, you can ignore this message.',
    });
    const text = `${BRAND} — Confirm your email\n\nThanks for signing up. Open this link to verify your address:\n${link}\n\n${SUPPORT_TEXT}\n\nIf you didn’t sign up, ignore this email.`;
    return { html, text };
}

function passwordResetEmail(link) {
    const html = wrapHtml({
        title: 'Reset your password',
        lead: 'We received a request to reset the password for your account. Use the button below to choose a new password.',
        buttonLabel: 'Reset password',
        actionUrl: link,
        footerNote: 'If you didn’t ask for a reset, you can safely ignore this email — your password will stay the same.',
    });
    const text = `${BRAND} — Reset your password\n\nOpen this link to set a new password:\n${link}\n\n${SUPPORT_TEXT}\n\nIf you didn’t request this, ignore this email.`;
    return { html, text };
}

module.exports = { verificationEmail, passwordResetEmail };
