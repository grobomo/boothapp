'use strict';

/**
 * Exponential backoff retry utility.
 *
 * Retries `fn` up to `maxRetries` times with exponential delay and jitter.
 * Only retries when `shouldRetry(err)` returns true (defaults to always retry).
 *
 * @param {Function} fn            - async function to execute
 * @param {Object}   [opts]
 * @param {number}   [opts.maxRetries=3]   - maximum number of retry attempts
 * @param {number}   [opts.baseDelayMs=1000] - initial delay in ms
 * @param {number}   [opts.maxDelayMs=30000] - delay cap in ms
 * @param {Function} [opts.shouldRetry]    - predicate (err) => boolean; default always true
 * @param {Function} [opts.onRetry]        - callback (err, attempt, delayMs) => void
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
      const roundedDelay = Math.round(delay);
      onRetry(err, attempt + 1, roundedDelay);
      await new Promise((r) => setTimeout(r, roundedDelay));
    }
  }
  throw lastErr;
}

module.exports = { retry };
