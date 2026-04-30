/**
 * One-off: send a test event to Sentry so Issues / Environments populate.
 * Run from the server directory (same .env as the API):
 *   npm run sentry:ping
 */
const path = require('path');
const fs = require('fs');
const dotenvPath = [path.join(__dirname, '../.env'), path.join(__dirname, '../../.env')].find((p) => fs.existsSync(p));
require('dotenv').config(dotenvPath ? { path: dotenvPath } : {});

// Avoid Jest / test path disabling Sentry
if (process.env.NODE_ENV === 'test') {
  process.env.NODE_ENV = 'development';
}

const { Sentry, sentryEnabled } = require('../src/instrument');
const serverDir = path.join(__dirname, '..');

if (!Sentry) {
  console.error(
    '@sentry/node did not load. It must be in server/package.json; then install deps:\n' +
      `  cd ${serverDir} && npm install\n` +
      'If you only run npm install at the repo root, run that root install too (root package.json also lists Sentry), or use: npm install --prefix server'
  );
  process.exit(1);
}
if (!sentryEnabled) {
  console.error(
    'Sentry is not enabled. Set SENTRY_DSN in server/.env (or repo-root .env), and ensure NODE_ENV is not "test".'
  );
  process.exit(1);
}

Sentry.captureMessage('Play Spotter: manual ping (npm run sentry:ping)', 'info');
Sentry.flush(5000)
  .then(() => {
    const env = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
    console.log('Done. Open Sentry → Issues, time range = Last hour, and look for this message.');
    console.log('Environment on the event should be:', env);
    process.exit(0);
  })
  .catch((e) => {
    console.error('Flush failed:', e);
    process.exit(1);
  });
