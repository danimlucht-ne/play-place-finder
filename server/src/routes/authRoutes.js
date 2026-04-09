const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const axios = require('axios');
const { getDb } = require('../database');
const { sendEmail } = require('../services/notificationService');
const { validatePasswordStrength } = require('../utils/passwordPolicy');
const { verificationEmail, passwordResetEmail } = require('../templates/authEmails');

// POST /api/users/register
router.post('/register', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }
    const pwError = validatePasswordStrength(password);
    if (pwError) {
        return res.status(400).json({ error: pwError });
    }
    try {
        const userRecord = await admin.auth().createUser({ email, password });
        const uid = userRecord.uid;

        const db = getDb();
        await db.collection('users').updateOne(
            { _id: uid },
            { $setOnInsert: { _id: uid, email, createdAt: new Date(), score: 0, level: 'Newcomer', contributions: { total: 0, newPlaygrounds: 0, edits: 0, photos: 0, reports: 0 } } },
            { upsert: true }
        );

        // 4.5.2 — send email verification link (non-fatal)
        try {
            const verificationLink = await admin.auth().generateEmailVerificationLink(email);
            const { html, text } = verificationEmail(verificationLink);
            await sendEmail(email, 'Confirm your email — Play Place Finder', text, html);
        } catch (emailErr) {
            console.warn('Could not send verification email:', emailErr.message);
        }

        // Exchange custom token for an ID token (custom tokens cannot be used as bearer tokens)
        const apiKey = process.env.FIREBASE_WEB_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Server misconfiguration: FIREBASE_WEB_API_KEY not set.' });
        }
        const customToken = await admin.auth().createCustomToken(uid);
        const exchangeRes = await axios.post(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
            { token: customToken, returnSecureToken: true }
        );
        const idToken = exchangeRes.data.idToken;
        res.status(201).json({ message: 'success', token: idToken, userId: uid });
    } catch (err) {
        console.error('Register error:', err.message);
        if (err.code === 'auth/email-already-exists') {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }
    try {
        const apiKey = process.env.FIREBASE_WEB_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Server misconfiguration: FIREBASE_WEB_API_KEY not set.' });
        }
        const firebaseRes = await axios.post(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
            { email, password, returnSecureToken: true }
        );
        const { localId: uid, idToken } = firebaseRes.data;

        const db = getDb();
        await db.collection('users').updateOne(
            { _id: uid },
            { $setOnInsert: { _id: uid, email, createdAt: new Date(), score: 0, level: 'Newcomer', contributions: { total: 0, newPlaygrounds: 0, edits: 0, photos: 0, reports: 0 } } },
            { upsert: true }
        );

        // Check if user is blocked or banned
        const userDoc = await db.collection('users').findOne({ _id: uid });
        if (userDoc?.bannedAt) {
            return res.status(403).json({ error: 'Your account has been permanently banned. Reason: ' + (userDoc.bannedReason || 'Policy violation') });
        }
        if (userDoc?.blockedAt) {
            return res.status(403).json({ error: 'Your account is temporarily blocked. Reason: ' + (userDoc.blockedReason || 'Policy violation') });
        }

        res.json({ message: 'success', token: idToken, userId: uid });
    } catch (err) {
        console.error('Login error:', err.response?.data || err.message);
        const fbError = err.response?.data?.error?.message;
        if (fbError === 'EMAIL_NOT_FOUND' || fbError === 'INVALID_PASSWORD' || fbError === 'INVALID_LOGIN_CREDENTIALS') {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }
        res.status(500).json({ error: 'Login failed.' });
    }
});

// POST /api/users/resend-verification  (4.5.2)
router.post('/resend-verification', async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    try {
        const verificationLink = await admin.auth().generateEmailVerificationLink(email);
        const { html, text } = verificationEmail(verificationLink);
        await sendEmail(email, 'Confirm your email — Play Place Finder', text, html);
        res.json({ message: 'Verification email sent.' });
    } catch (err) {
        console.error('Resend verification error:', err.message);
        res.status(500).json({ error: 'Could not send verification email.' });
    }
});

// POST /api/users/reset-password  (4.5.5)
router.post('/reset-password', async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    try {
        const resetLink = await admin.auth().generatePasswordResetLink(email);
        const { html, text } = passwordResetEmail(resetLink);
        await sendEmail(email, 'Reset your password — Play Place Finder', text, html);
        // Always return success to avoid leaking whether email exists
        res.json({ message: 'If that email is registered, a reset link has been sent.' });
    } catch (err) {
        console.error('Reset password error:', err.message);
        res.json({ message: 'If that email is registered, a reset link has been sent.' });
    }
});

module.exports = router;
