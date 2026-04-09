const admin = require('firebase-admin');
const { getDb } = require('../database');
const { loadFirebaseServiceAccountJson } = require('../loadFirebaseServiceAccount');

let firebaseAppInitialized = false;

/** Mock JWT bypass: only in Jest (NODE_ENV=test) or when ALLOW_MOCK_AUTH is explicitly true — never on other NODE_ENV values. */
function allowMockAuthBypass() {
  if (process.env.ALLOW_MOCK_AUTH === 'true' || process.env.ALLOW_MOCK_AUTH === '1') return true;
  return process.env.NODE_ENV === 'test';
}

function resolveFirebaseProjectId(serviceAccount) {
  return (
    process.env.FIREBASE_PROJECT_ID
    || process.env.GCLOUD_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || (serviceAccount && serviceAccount.project_id)
    || ''
  ).trim();
}

let serviceAccount;
try {
  serviceAccount = loadFirebaseServiceAccountJson();
} catch (e) {
  console.error('Failed to read Firebase service account JSON:', e.message);
  serviceAccount = null;
}

try {
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      ...(resolveFirebaseProjectId(serviceAccount) ? { projectId: resolveFirebaseProjectId(serviceAccount) } : {}),
    });
    firebaseAppInitialized = true;
    console.log('Firebase Admin SDK initialized successfully (service account JSON).');
  } else {
    // GCE / Cloud Run / local with gcloud ADC: no key file; use VM/workload identity.
    const projectId = resolveFirebaseProjectId(null);
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      ...(projectId ? { projectId } : {}),
    });
    firebaseAppInitialized = true;
    console.log('Firebase Admin SDK initialized successfully (Application Default Credentials).');
  }
} catch (error) {
  firebaseAppInitialized = false;
  console.error('Firebase Admin SDK initialization failed:', error.message);
  console.error(
    'For GCE: attach a service account with Firebase Auth (and other) roles, set FIREBASE_PROJECT_ID or rely on '
      + 'metadata, and unset GOOGLE_APPLICATION_CREDENTIALS. For local dev: set GOOGLE_APPLICATION_CREDENTIALS or use '
      + 'server/serviceAccountKey.json (gitignored).',
  );
}

async function verifyToken(req, res, next) {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken) {
    if (process.env.LOG_AUTH_FAILURES === '1' || process.env.LOG_AUTH_FAILURES === 'true') {
      console.warn('[verifyToken] missing Bearer', {
        method: req.method,
        path: req.originalUrl || req.url,
        contentType: req.get('Content-Type'),
      });
    }
    return res.status(401).send('Unauthorized: No token provided.');
  }

  if (allowMockAuthBypass() && idToken.startsWith('mock_jwt_token_for_')) {
    console.warn('DEVELOPMENT BYPASS: Accepting mock token for testing.');
    req.user = { uid: idToken.replace('mock_jwt_token_for_', '') };
    return next();
  }

  if (!firebaseAppInitialized) {
    return res.status(500).send('Authentication service not initialized.');
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    res.status(403).send('Forbidden: Invalid or expired token.');
  }
}

/**
 * If a Bearer token is present and valid, attaches req.user (same as verifyToken).
 * If missing or invalid, continues without req.user — for endpoints that must work when logged out (e.g. hybrid map seed).
 */
async function optionalVerifyToken(req, res, next) {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken) {
    return next();
  }
  if (allowMockAuthBypass() && idToken.startsWith('mock_jwt_token_for_')) {
    req.user = { uid: idToken.replace('mock_jwt_token_for_', '') };
    return next();
  }
  if (!firebaseAppInitialized) {
    return next();
  }
  try {
    req.user = await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    console.warn('optionalVerifyToken: invalid token, continuing as anonymous:', error.message);
  }
  next();
}

async function verifyAdminToken(req, res, next) {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken) {
    return res.status(401).send('Unauthorized: No token provided.');
  }

  if (allowMockAuthBypass() && idToken.startsWith('mock_jwt_token_for_')) {
    console.warn('DEVELOPMENT BYPASS: Accepting mock token for admin testing.');
    req.user = { uid: idToken.replace('mock_jwt_token_for_', ''), admin: true };
    return next();
  }

  if (!firebaseAppInitialized) {
    return res.status(500).send('Authentication service not initialized.');
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    if (decodedToken.admin === true) {
      req.user = decodedToken;
      next();
    } else {
      res.status(403).send('Forbidden: Admin role required.');
    }
  } catch (error) {
    console.error('Admin token verification failed:', error.message);
    res.status(403).send('Forbidden: Invalid or unauthorized token.');
  }
}

async function ensureCanSubmit(req, res, next) {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne(
      { _id: req.user.uid },
      { projection: { blockedAt: 1, blockedReason: 1, bannedAt: 1, bannedReason: 1 } },
    );

    if (!user) return next();

    if (user.bannedAt) {
      return res.status(403).json({
        error: 'Your account is banned from submissions.',
        reason: user.bannedReason || null,
      });
    }

    if (user.blockedAt) {
      return res.status(403).json({
        error: 'Your account is temporarily blocked from submissions.',
        reason: user.blockedReason || null,
      });
    }

    next();
  } catch (error) {
    console.error('Submission access check failed:', error.message);
    res.status(500).json({ error: 'Failed to validate submission permissions.' });
  }
}

module.exports = { verifyToken, verifyAdminToken, optionalVerifyToken, ensureCanSubmit };
