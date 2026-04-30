/**
 * Sentry must load after server/.env is read (for SENTRY_DSN) but before the rest of the app.
 * Profiling extends tracing (both need @sentry/profiling-node on the host).
 */
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

function clamp01(n) {
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * @param {string} [key] process.env key
 * @param {number} whenUnsetProd default when NODE_ENV=production and key unset/empty
 * @param {number} whenUnsetDev default when not production and key unset/empty
 */
function sampleRateFromEnv(key, whenUnsetProd, whenUnsetDev) {
  const raw = process.env[key];
  const isProd = process.env.NODE_ENV === 'production';
  if (raw === undefined || String(raw).trim() === '') {
    return isProd ? whenUnsetProd : whenUnsetDev;
  }
  return clamp01(parseFloat(String(raw), 10));
}

/** PII: off in production by default; set SENTRY_SEND_DEFAULT_PII=true to opt in. */
function sendDefaultPii() {
  const v = process.env.SENTRY_SEND_DEFAULT_PII;
  if (v === undefined || v === '') {
    return process.env.NODE_ENV !== 'production';
  }
  return v === '1' || String(v).toLowerCase() === 'true';
}

if (process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') {
  // Production defaults: low volume + cost. Override with SENTRY_*_SAMPLE_RATE in .env.
  // Dev: slightly more signals while developing. Tuning: profiles ≤ traces.
  const traces = sampleRateFromEnv('SENTRY_TRACES_SAMPLE_RATE', 0.05, 0.15);
  let profiles = sampleRateFromEnv('SENTRY_PROFILES_SAMPLE_RATE', 0.05, 0.1);
  if (traces === 0) {
    profiles = 0;
  } else {
    profiles = Math.min(profiles, traces);
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    sendDefaultPii: sendDefaultPii(),
    integrations: [Sentry.expressIntegration(), nodeProfilingIntegration()],
    tracesSampleRate: traces,
    profilesSampleRate: profiles,
  });
}

module.exports = { Sentry, sentryEnabled: Boolean(process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') };
