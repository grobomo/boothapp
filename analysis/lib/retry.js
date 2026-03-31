'use strict';

/**
 * Exponential backoff retry utility.
 *
 * Retries `fn` up to `maxRetries` times with exponential delay and jitter.
 * Only retries when `shouldRetry(err)` returns true (defaults to always retry).
 *
 * @param {Function} fn           - async function to execute
 * @param {Object}   [opts]
 * @param {number}   [opts.maxRetries=3]    - max number of retries (not counting initial attempt)
 * @param {number}   [opts.baseDelayMs=1000] - base delay in ms before first retry
 * @param {number}   [opts.maxDelayMs=30000] - cap on delay between retries
 * @param {Function} [opts.shouldRetry]      - predicate (err) => boolean; default: always retry
 * @param {Function} [opts.onRetry]          - callback (err, attempt, delayMs) called before each retry wait
 * @returns {Promise<*>} result of fn()
 */
async function retry(fn, opts = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry = () => true,
    onRetry = () => {},
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      if (!shouldRetry(err) || attempt >= maxRetries) {
        throw err;
      }

      const jitter = Math.random() * 0.3 + 0.85; // 0.85 - 1.15
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) * jitter, maxDelayMs);
      onRetry(err, attempt + 1, Math.round(delay));
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

module.exports = { retry };
