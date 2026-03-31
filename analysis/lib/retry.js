'use strict';

/**
 * Exponential backoff retry utility.
 *
 * Retries `fn` up to `maxRetries` times with exponential delay and jitter.
 * Only retries when `shouldRetry(err)` returns true (defaults to always retry).
 *
 * @param {Function} fn            - async function to call
 * @param {Object}   [opts]
 * @param {number}   [opts.maxRetries=2]   - max retry attempts (not counting initial call)
 * @param {number}   [opts.baseDelayMs=1000] - base delay in milliseconds
 * @param {number}   [opts.maxDelayMs=30000] - maximum delay cap in milliseconds
 * @param {Function} [opts.shouldRetry]      - predicate (err) => boolean (default: always true)
 * @param {Function} [opts.onRetry]          - callback (err, attempt, delayMs) => void
 * @returns {Promise<*>} result of fn()
 */
async function retryWithExponentialBackoff(fn, opts = {}) {
  const {
    maxRetries = 2,
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
      const delayRounded = Math.round(delay);
      onRetry(err, attempt + 1, delayRounded);
      await new Promise((r) => setTimeout(r, delayRounded));
    }
  }
  throw lastErr;
}

module.exports = { retryWithExponentialBackoff };
