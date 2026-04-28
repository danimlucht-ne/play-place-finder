const path = require('path');
const fs = require('fs');
// Prefer server/.env; also try repo-root .env if the process cwd differs.
const dotenvPath = [path.join(__dirname, '../.env'), path.join(__dirname, '../../.env')].find((p) => fs.existsSync(p));
require('dotenv').config(dotenvPath ? { path: dotenvPath } : {});
const express = require('express');
const { connectToServer, getDb } = require('./database');
const { ObjectId } = require('mongodb');
const { Storage } = require('@google-cloud/storage');
const crypto = require('crypto');
const multer = require('multer');
const { GoogleGenAI, Type } = require('@google/genai');
const axios = require('axios');
const vision = require('@google-cloud/vision');
const helmet = require('helmet');
const { isOriginAllowed } = require('./utils/corsConfig');
const {
    ALLOWED_IMAGE_TYPES,
    allowedMimeSet,
    assertValidImageBuffer,
    MAX_USER_UPLOAD_IMAGE_BYTES,
} = require('./utils/imageUploadValidation');
const {
    authEndpointLimiter,
    userImageUploadLimiter,
    userMutationLimiter,
    reportSupportMutationLimiter,
    adminMutationLimiter,
    limitWrites,
} = require('./middleware/securityRateLimiters');

// --- SERVICES ---
const { verifyToken, verifyAdminToken, optionalVerifyToken } = require('./services/authService');
const contributionService = require('./services/contributionService');
const adminModerationService = require('./services/adminModerationService');
const { initPhotoUpload, processPhoto } = require('./services/photoUploadService');
const { sendAdminNotificationEmail } = require('./services/notificationService');
const { adServingLimiter, adEventLimiter } = require('./middleware/adRateLimiter');
const seedOrchestratorService = require('./services/seedOrchestratorService');
const dynamicOptionsService = require('./services/dynamicOptionsService');

// --- MODERATION ENUMS (for backend consistency) ---
const ModerationStatus = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    AUTO_APPROVED: 'AUTO_APPROVED',
    NEEDS_ADMIN_REVIEW: 'NEEDS_ADMIN_REVIEW',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    FAILED: 'FAILED'
};

const SubmissionType = {
    PHOTO: 'PHOTO',
    PLAYGROUND_EDIT: 'PLAYGROUND_EDIT',
    NEW_PLAYGROUND: 'NEW_PLAYGROUND',
    REVIEW: 'REVIEW',
    ISSUE_REPORT: 'ISSUE_REPORT',
    ABUSE_TICKET: 'ABUSE_TICKET'
};

const AdminDecision = {
    APPROVE: 'APPROVE',
    REJECT: 'REJECT',
    RETRY: 'RETRY'
};

// --- COMMUNITY TRUST ENUMS ---
const ReportStatus = {
    OPEN: 'open',
    CONFIRMED: 'confirmed',
    RESOLVED: 'resolved'
};

const IssueReportType = {
    BROKEN_EQUIPMENT: 'broken_equipment',
    UNSAFE_AREA: 'unsafe_area',
    TRAFFIC_RISK: 'traffic_risk',
    AGGRESSIVE_DOGS: 'aggressive_dogs',
    INCORRECT_INFO: 'incorrect_info',
    OTHER: 'other'
};

const CrowdLevel = {
    QUIET: 'Quiet',
    BUSY: 'Busy',
    PACKED: 'Packed'
};

// --- SUPPORT TICKETS ---
const SupportTicketType = {
    QUESTION: 'question',
    COMPLAINT: 'complaint',
    REQUEST_UPDATE: 'request_update',
    REPORT_ISSUE: 'report_issue',
    OTHER: 'other'
};

const SupportTicketStatus = {
    NEEDS_ADMIN_REVIEW: 'NEEDS_ADMIN_REVIEW',
    RESOLVED: 'RESOLVED',
    REJECTED: 'REJECTED'
};

const app = express();

// Behind nginx / GCE LB / Cloud CDN, clients appear as the proxy unless Express trusts X-Forwarded-*.
// Required for express-rate-limit when X-Forwarded-For is present (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR).
// TRUST_PROXY: 1 / true = one hop; 0 / false = off; number = hop count. Empty/unset + NODE_ENV=production defaults to 1
// (empty TRUST_PROXY in .env often overrides PM2 and left trust proxy false — that caused ERL errors).
(function configureTrustProxy() {
    const raw = process.env.TRUST_PROXY;
    const trimmed = raw === undefined || raw === null ? '' : String(raw).trim();
    if (trimmed === '') {
        if (process.env.NODE_ENV === 'production') {
            app.set('trust proxy', 1);
        }
        return;
    }
    const s = trimmed.toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') {
        app.set('trust proxy', 1);
        return;
    }
    if (s === 'false' || s === '0' || s === 'no') {
        app.set('trust proxy', false);
        return;
    }
    const n = parseInt(trimmed, 10);
    if (!Number.isNaN(n) && n >= 0) {
        app.set('trust proxy', n);
    }
})();

const HTTP_PORT = 8000;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let ai;
try {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
} catch (error) {
    console.error("Error initializing GoogleGenAI in index.js. Check GEMINI_API_KEY.", error.message);
    ai = { getGenerativeModel: () => ({ generateContent: () => ({ response: { text: () => '{ "photoUseful": false, "playgroundVisible": false, "peopleDetected": true, "recommendedAction": "REJECT", "confidence": 0.0, "notes": "AI not initialized." }' } }) }) };
}
const visionClient = new vision.ImageAnnotatorClient(
    process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? { keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS }
        : {}
);

const allowedImageMimes = allowedMimeSet();
// User profile / submission photos via this endpoint only; validate MIME + magic bytes (see assertValidImageBuffer).
const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_USER_UPLOAD_IMAGE_BYTES },
    fileFilter: (req, file, cb) => {
        if (allowedImageMimes.has(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid image type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`));
        }
    },
});

const storage = new Storage();
const publicBucket = storage.bucket("playground_app_bucket");
const quarantineBucket = storage.bucket("playground_app_bucket"); // same bucket, quarantine/ prefix for paths

// --- LOAD ROUTERS ---
let playgroundRoutes, userRoutes, adminRoutes, reportRoutes, supportRoutes, seedRoutes, authRoutes, regionRoutes;
let adSubmissionRoutes, adPaymentRoutes, adServingRoutes, adTrackingRoutes, adAdminRoutes, adAnalyticsRoutes;
try { playgroundRoutes = require('./routes/playgroundRoutes'); } catch(e) { console.error('Failed to load playgroundRoutes:', e); process.exit(1); }
try { userRoutes = require('./routes/userRoutes'); } catch(e) { console.error('Failed to load userRoutes:', e); process.exit(1); }
try { adminRoutes = require('./routes/adminRoutes'); } catch(e) { console.error('Failed to load adminRoutes:', e); process.exit(1); }
try { reportRoutes = require('./routes/reportRoutes'); } catch(e) { console.error('Failed to load reportRoutes:', e); process.exit(1); }
try { supportRoutes = require('./routes/supportRoutes'); } catch(e) { console.error('Failed to load supportRoutes:', e); process.exit(1); }
try { seedRoutes = require('./routes/seedRoutes'); } catch(e) { console.error('Failed to load seedRoutes:', e); process.exit(1); }
try { authRoutes = require('./routes/authRoutes'); } catch(e) { console.error('Failed to load authRoutes:', e); process.exit(1); }
try { regionRoutes = require('./routes/regionRoutes'); } catch(e) { console.error('Failed to load regionRoutes:', e); process.exit(1); }
try { adSubmissionRoutes = require('./routes/adSubmissionRoutes'); } catch(e) { console.error('Failed to load adSubmissionRoutes:', e); process.exit(1); }
try { adPaymentRoutes = require('./routes/adPaymentRoutes'); } catch(e) { console.error('Failed to load adPaymentRoutes:', e); process.exit(1); }
try { adServingRoutes = require('./routes/adServingRoutes'); } catch(e) { console.error('Failed to load adServingRoutes:', e); process.exit(1); }
try { adTrackingRoutes = require('./routes/adTrackingRoutes'); } catch(e) { console.error('Failed to load adTrackingRoutes:', e); process.exit(1); }
try { adAdminRoutes = require('./routes/adAdminRoutes'); } catch(e) { console.error('Failed to load adAdminRoutes:', e); process.exit(1); }
try { adAnalyticsRoutes = require('./routes/adAnalyticsRoutes'); } catch(e) { console.error('Failed to load adAnalyticsRoutes:', e); process.exit(1); }
let adDiscountAdminRoutes, adDiscountValidateRoutes;
try { const { adminRouter, validateRouter } = require('./routes/adDiscountRoutes'); adDiscountAdminRoutes = adminRouter; adDiscountValidateRoutes = validateRouter; } catch(e) { console.error('Failed to load adDiscountRoutes:', e); process.exit(1); }
let campaignManagementRoutes;
try { campaignManagementRoutes = require('./routes/campaignManagementRoutes'); } catch(e) { console.error('Failed to load campaignManagementRoutes:', e); process.exit(1); }
let adminCampaignRoutes;
try { adminCampaignRoutes = require('./routes/adminCampaignRoutes'); } catch(e) { console.error('Failed to load adminCampaignRoutes:', e); process.exit(1); }
let advertiserRoutes;
try { advertiserRoutes = require('./routes/advertiserRoutes'); } catch(e) { console.error('Failed to load advertiserRoutes:', e); process.exit(1); }
const adminServerLogRoutes = require('./routes/adminServerLogRoutes');

// Stripe webhook needs raw body — mount BEFORE JSON body parser
app.use('/api/ads/payments/webhook', express.raw({ type: 'application/json' }), adPaymentRoutes);

// JSON body parser for all other routes
app.use(express.json());

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS for browser clients (web hub + marketing site calling API directly).
app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (!origin) return next();
    if (!isOriginAllowed(origin, process.env)) {
        if (req.method === 'OPTIONS') return res.status(403).json({ error: 'CORS origin denied.' });
        return res.status(403).json({ error: 'Origin not allowed.' });
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Requested-With');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
});

// Request correlation for access logs, errors, and admin log tail API
app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const useIncoming = typeof incoming === 'string' && incoming.trim().length > 0 && incoming.length <= 128;
    req.id = useIncoming ? incoming.trim() : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
});

if (process.env.NODE_ENV !== 'test') {
    const morgan = require('morgan');
    morgan.token('id', (req) => req.id);
    app.use(morgan(':id :method :url :status :res[content-length] - :response-time ms', {
        skip: (req) => {
            const p = req.originalUrl.split('?')[0];
            return p === '/api/health';
        },
    }));
}

// Middleware for handling MongoDB ObjectId conversion (strict 24-char hex only — isValid() is too loose and can throw)
app.use('/:collection/:id', (req, res, next) => {
    const raw = req.params.id;
    if (raw != null && raw !== '') {
        const s = String(raw);
        if (/^[a-fA-F0-9]{24}$/.test(s)) {
            try {
                req.params.id = new ObjectId(s);
            } catch (_) {
                /* keep string id */
            }
        }
    }
    next();
});

// --- PUBLIC ROUTES (No Auth Required) ---
app.use('/api/playgrounds', playgroundRoutes);
// 9.7 — city completion meter: mount only the specific sub-path to avoid collision
app.use('/api/cities', playgroundRoutes);
app.use('/api/users', authEndpointLimiter, authRoutes);  // login + register (public)
app.use('/api/ads', adServingLimiter, adServingRoutes); // public ad serving (house ads, no auth needed)

// Health check — public, no auth, for uptime monitors
let healthRoutes;
try { healthRoutes = require('./routes/healthRoutes'); } catch(e) { console.error('Failed to load healthRoutes:', e); }
if (healthRoutes) app.use('/api/health', healthRoutes);

// Hybrid map seed — must work without login (browse / first open). Still enriches favorites when a valid token is sent.
app.post('/api/search/hybrid', optionalVerifyToken, seedRoutes.hybridSearchHandler);

// --- PROTECTED ROUTES (User Auth Required) ---
app.use(verifyToken);

// Simple image upload endpoint — accepts multipart form data, stores in GCS, returns URL
const { uploadBufferToPublic } = require('./services/storageService');
app.post('/api/upload-image', userImageUploadLimiter, uploadImage.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image file provided.' });
        const { contentType } = await assertValidImageBuffer(req.file.buffer, req.file.mimetype, {
            maxBytes: MAX_USER_UPLOAD_IMAGE_BYTES,
        });
        const url = await uploadBufferToPublic(req.file.buffer, 'user-uploads', { contentType });
        res.json({ message: 'success', url });
    } catch (err) {
        if (err.statusCode === 400) {
            return res.status(400).json({ error: err.message });
        }
        console.error('[upload-image] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.use('/api', limitWrites(userMutationLimiter), userRoutes);
// Log tail is mounted at /admin and /api/admin so a reverse proxy that only forwards /api/* still reaches it.
app.use('/admin', adminServerLogRoutes);
app.use('/api/admin', adminServerLogRoutes);
app.use('/admin', limitWrites(adminMutationLimiter), adminRoutes);
app.use('/api/reports', limitWrites(reportSupportMutationLimiter), reportRoutes);
app.use('/api/support', limitWrites(reportSupportMutationLimiter), supportRoutes);
app.use('/api', seedRoutes);
app.use('/api/regions', regionRoutes);
app.use('/api/advertisers', advertiserRoutes);
app.use('/api/ads/submissions', adSubmissionRoutes);
app.use('/api/ads/campaigns', campaignManagementRoutes);
app.use('/api/ads/payments', adPaymentRoutes);
app.use('/api/ads/events', adEventLimiter, adTrackingRoutes);
app.use('/api/ads/analytics', adAnalyticsRoutes);
app.use('/admin/ads/discounts', adDiscountAdminRoutes);
app.use('/admin/ads/campaigns', adminCampaignRoutes);
app.use('/admin/ads', adAdminRoutes);
app.use('/api/ads/discounts', adDiscountValidateRoutes);

// Default response for any other request
app.use(function(req, res) {
    res.status(404).send("Not Found");
});

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large.' });
        }
        return res.status(400).json({ error: err.message || 'Upload error.' });
    }
    const msg = err && err.message ? String(err.message) : '';
    if (msg.includes('Invalid image type')) {
        return res.status(400).json({ error: msg });
    }
    next(err);
});

/**
 * Connect to MongoDB and ensure indexes (used on server boot and by integration tests).
 * Skips lifecycle cron in NODE_ENV=test to avoid background timers during Jest.
 */
async function runStartupTasks() {
    await connectToServer();
    const db = getDb();
    await db.collection("playgrounds").createIndex({ location: "2dsphere" });
    await db.collection("businesses").createIndex({ location: "2dsphere" });
    await db.collection('users').createIndex({ score: -1 });
    await db.collection('users').createIndex({ city: 1, score: -1 });
    await db.collection('users').createIndex({ regionKey: 1 });
    await db.collection('user_consents').createIndex({ userId: 1, consentType: 1, consentVersion: 1 });
    await db.collection('contribution_log').createIndex({ userId: 1 });
    await db.collection('contribution_log').createIndex({ createdAt: -1 });
    await db.collection('photo_uploads').createIndex({ "quarantineExpiresAt": 1 }, { expireAfterSeconds: 0 });
    await db.collection('moderation_queue').createIndex({ "rejectionExpiresAt": 1 }, { expireAfterSeconds: 0 });
    await db.collection('moderation_outcomes').createIndex({ userId: 1, createdAt: -1 });
    await db.collection('moderation_outcomes').createIndex({ userId: 1, outcome: 1, submissionType: 1, createdAt: -1 });
    await db.collection('crowd_reports').createIndex({ "createdAt": 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
    await db.collection('issue_reports').createIndex({ "createdAt": 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
    await db.collection('support_tickets').createIndex({ actorUserId: 1 });
    await db.collection('support_tickets').createIndex({ status: 1, createdAt: -1 });
    await db.collection('monthly_awards').createIndex({ regionKey: 1, month: 1 }, { unique: true });
    await db.collection('advertiser_intakes').createIndex({ contactEmail: 1 }, { unique: true });
    await db.collection('advertiser_intakes').createIndex({ status: 1, createdAt: -1 });
    await db.collection('seeded_regions').createIndex({ regionKey: 1 }, { unique: true });
    await db.collection('seed_tiles').createIndex({ tileKey: 1 }, { unique: true });
    await db.collection('seed_tiles').createIndex({ regionKey: 1, lastTouchedAt: -1 });
    await db.collection('seed_run_logs').createIndex({ regionKey: 1, createdAt: -1 });
    await db.collection('seed_run_logs').createIndex({ runType: 1, createdAt: -1 });
    await db.collection('location_verifications').createIndex({ locationId: 1, verifiedAt: -1 });
    await db.collection('location_verifications').createIndex({ locationId: 1, userId: 1, verifiedAt: -1 });
    await db.collection('playgrounds').createIndex({ regionKey: 1 });
    await db.collection('favorites').createIndex({ userId: 1, placeId: 1 }, { unique: true });
    await db.collection('photo_scores').createIndex({ playgroundId: 1 });

    await db.collection('advertisers').createIndex({ userId: 1 }, { unique: true });
    await db.collection('advertisers').createIndex({ regionKey: 1, status: 1 });
    await db.collection('adSubmissions').createIndex({ advertiserId: 1, status: 1 });
    await db.collection('adSubmissions').createIndex({ status: 1, createdAt: -1 });
    await db.collection('adCampaigns').createIndex({ cityId: 1, placement: 1, status: 1, startDate: 1, endDate: 1 });
    await db.collection('adCampaigns').createIndex({ advertiserId: 1 });
    await db.collection('adCampaigns').createIndex({ status: 1, startDate: 1 });
    await db.collection('adCampaigns').createIndex({ status: 1, endDate: 1 });
    await db.collection('adTargeting').createIndex({ campaignId: 1 });
    await db.collection('adTargeting').createIndex({ cityId: 1, placement: 1 });
    await db.collection('adEvents').createIndex({ campaignId: 1, type: 1, timestamp: 1 });
    await db.collection('adEvents').createIndex({ adId: 1, userId: 1, type: 1, timestamp: 1 });
    await db.collection('adEvents').createIndex({ adId: 1, visitorKey: 1, type: 1, timestamp: 1 });
    await db.collection('adEvents').createIndex({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
    await db.collection('adCampaignDailyStats').createIndex({ campaignId: 1, ymd: 1 }, { unique: true });
    await db.collection('adCampaignDailyStats').createIndex({ ymd: 1 });
    await db.collection('adImpressionDedupes').createIndex({ at: 1 }, { expireAfterSeconds: 48 * 3600 });
    // Sparse: many free checkouts use a synthetic id (see adPaymentRoutes); legacy rows may omit the field.
    try {
        await db.collection('paymentTransactions').dropIndex('stripePaymentIntentId_1');
    } catch (e) {
        const msg = String(e.message || '');
        const missing =
            e.code === 27 ||
            e.codeName === 'IndexNotFound' ||
            /index not found|ns not found/i.test(msg);
        if (!missing) throw e;
    }
    await db.collection('paymentTransactions').createIndex(
        { stripePaymentIntentId: 1 },
        { unique: true, sparse: true },
    );
    await db.collection('paymentTransactions').createIndex({ submissionId: 1 });
    await db.collection('reviewFlags').createIndex({ submissionId: 1 });
    await db.collection('reviewFlags').createIndex({ resolvedAt: 1 });
    await db.collection('cityAdSettings').createIndex({ cityId: 1 }, { unique: true });
    await db.collection('contractAgreements').createIndex({ submissionId: 1 });

    await db.collection('cityAdSettings').createIndex({ phase: 1 });
    await db.collection('adCampaigns').createIndex({ 'pricingLock.priceLockedUntil': 1 });

    await db.collection('adCampaigns').createIndex({ isEvent: 1, eventDate: 1, status: 1 });

    await db.collection('adCampaigns').createIndex({ targetedRegionKeys: 1 });
    await db.collection('adTargeting').createIndex({ cityId: 1, placement: 1, campaignId: 1 });

    await db.collection('discountCodes').createIndex(
        { code: 1 },
        { unique: true, collation: { locale: 'en', strength: 2 } }
    );
    await db.collection('discountCodes').createIndex({ active: 1, startDate: 1, endDate: 1 });
    await db.collection('discountCodes').createIndex(
        { loyaltySourceCampaignId: 1 },
        { unique: true, sparse: true },
    );
    await db.collection('discountRedemptions').createIndex({ discountCodeId: 1, redeemedAt: -1 });
    await db.collection('discountRedemptions').createIndex({ submissionId: 1 }, { unique: true });

    if (process.env.NODE_ENV !== 'test') {
        const cityPhaseService = require('./services/cityPhaseService');
        const campaignLifecycleService = require('./services/campaignLifecycleService');
        const adAnalyticsRollupService = require('./services/adAnalyticsRollupService');
        try {
            await cityPhaseService.migrateLegacyCityAdSettingsShape();
        } catch (err) {
            console.error('[city-ad-settings] migrate failed:', err.message);
        }
        setInterval(async () => {
            try {
                const transitions = await campaignLifecycleService.processLifecycleTransitions();
                const expirations = await campaignLifecycleService.processIntroExpirations();
                const expiringSent = await campaignLifecycleService.checkExpiringCampaigns();
                const midLoyaltyIssued = await campaignLifecycleService.checkMidCampaignLoyaltyDiscounts();
                const phaseSync = await cityPhaseService.syncRegionAdPhasesFromUserCounts();
                const total = (transitions.activated || 0) + (transitions.completed || 0) + (transitions.eventExpired || 0) + (expirations.expired || 0) + (expiringSent || 0) + (midLoyaltyIssued || 0) + (phaseSync.updated?.length || 0);
                if (total > 0 && process.env.LOG_LIFECYCLE_CRON === '1') {
                    console.log(`[lifecycle-cron] activated=${transitions.activated}, completed=${transitions.completed}, eventExpired=${transitions.eventExpired || 0}, introExpired=${expirations.expired}, expiringNotified=${expiringSent}, midLoyaltyIssued=${midLoyaltyIssued || 0}, adPhaseSync=${phaseSync.updated?.length || 0}`);
                }
            } catch (err) {
                console.error('[lifecycle-cron] Error:', err.message);
            }
        }, 5 * 60 * 1000);
        console.log('[lifecycle-cron] Started (every 5 minutes)');

        setInterval(async () => {
            try {
                await adAnalyticsRollupService.rollupRecentCampaignDays(2);
            } catch (err) {
                console.error('[ad-rollup-cron] Error:', err.message);
            }
        }, 60 * 60 * 1000);
        console.log('[ad-rollup-cron] Started (hourly)');
    }
}

module.exports = { app, runStartupTasks };

if (require.main === module) {
    // Bind all interfaces so physical phones on Wi‑Fi (or adb reverse to device loopback) can reach the API.
    // Default Node bind can be IPv6-only on some hosts; 0.0.0.0 is explicit for IPv4 LAN access.
    app.listen(HTTP_PORT, '0.0.0.0', async () => {
        try {
            await runStartupTasks();
            if (!process.env.SERVER_BASE_URL) {
                console.warn('WARNING: SERVER_BASE_URL is not set. Defaulting to http://localhost:8000. Image URLs may not resolve correctly for remote clients.');
            }
            console.log(`Server listening on http://0.0.0.0:${HTTP_PORT} (use your PC LAN IP or adb reverse + http://127.0.0.1:${HTTP_PORT} on device)`);
        } catch (err) {
            console.error("Failed to start server due to database connection error:", err);
            process.exit(1);
        }
    });
}
