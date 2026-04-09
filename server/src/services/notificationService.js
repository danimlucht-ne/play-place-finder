const nodemailer = require('nodemailer');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS; // App Password for Gmail

let transporter;

try {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS,
        },
        tls: {
            // Allow self-signed certs in dev (e.g. corporate proxy / antivirus MITM).
            // Remove this in production or set NODE_ENV=production to enforce cert validation.
            rejectUnauthorized: process.env.NODE_ENV === 'production'
        }
    });
} catch (error) {
    console.error("Nodemailer transporter initialization failed. Check EMAIL_USER/EMAIL_PASS.", error.message);
}

async function sendAdminNotificationEmail(subject, textContent, htmlContent) {
    if (!transporter) {
        console.error("Cannot send email: Nodemailer transporter not initialized.");
        return;
    }

    const mailOptions = {
        from: EMAIL_USER,
        to: ADMIN_EMAIL,
        subject: subject,
        text: textContent,
        html: htmlContent,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Admin notification email sent to ${ADMIN_EMAIL}: ${subject}`);
    } catch (error) {
        console.error(`Error sending admin notification email to ${ADMIN_EMAIL}:`, error.message);
    }
}

async function sendEmail(to, subject, textContent, htmlContent) {
    if (!transporter) {
        console.error("Cannot send email: Nodemailer transporter not initialized.");
        return;
    }
    try {
        await transporter.sendMail({ from: EMAIL_USER, to, subject, text: textContent, html: htmlContent });
        console.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
        console.error(`Error sending email to ${to}:`, error.message);
    }
}

module.exports = { sendAdminNotificationEmail, sendEmail };
