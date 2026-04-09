const fs = require('fs');
const path = require('path');

/** @returns {string|null} */
function resolveServiceAccountPath() {
  const fromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;
  if (fromEnv && String(fromEnv).trim()) {
    const p = path.resolve(String(fromEnv).trim());
    if (fs.existsSync(p)) return p;
  }
  const legacy = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

/**
 * Loads Firebase service account JSON for Admin SDK.
 * Order: GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_KEY_PATH, else server/serviceAccountKey.json (local only; never commit).
 * @returns {object|null}
 */
function loadFirebaseServiceAccountJson() {
  const p = resolveServiceAccountPath();
  if (!p) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

module.exports = { loadFirebaseServiceAccountJson, resolveServiceAccountPath };
