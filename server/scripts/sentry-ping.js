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

if (!Sentry || !sentryEnabled) {
  console.error('Sentry is not enabled. Set SENTRY_DSN in server/.env, run npm install, then try again.');
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
