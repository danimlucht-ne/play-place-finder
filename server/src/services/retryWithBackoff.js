/**
 * Retries an async function with exponential backoff.
 * @param {Function} fn — async function to retry
 * @param {Object} opts
 * @param {number} opts.maxRetries — max retry attempts (default 3)
 * @param {number} opts.baseDelayMs — initial delay in ms (default 1000)
 * @param {number} opts.maxDelayMs — max delay cap in ms (default 30000)
 * @param {Function} opts.shouldRetry — (error) => boolean, default retries on 429/500/503
 * @param {string} opts.label — label for logging
 * @returns {Promise<*>} result of fn()
 */
async function retryWithBackoff(fn, opts = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry = defaultShouldRetry,
    label = 'retryWithBackoff',
  } = opts;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !shouldRetry(err)) throw err;

      const jitter = Math.random() * 500;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs);
      console.warn(`[${label}] Attempt ${attempt + 1} failed: ${err.message}. Retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function defaultShouldRetry(err) {
  const status = err.response?.status || err.status || err.code;
  // Retry on rate limit (429), server errors (500, 502, 503), and network errors
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') return true;
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('rate limit') || msg.includes('quota') || msg.includes('resource exhausted') || msg.includes('too many requests')) return true;
  return false;
}

module.exports = { retryWithBackoff };
