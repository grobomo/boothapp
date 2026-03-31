'use strict';

// Exponential backoff retry utility
//
// Usage:
//   const { withRetry } = require('./lib/retry');
//   const result = await withRetry('S3 fetch', fn, { maxRetries: 3, baseDelayMs: 1000 });

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff.
 *
 * @param {string} label - Human-readable label for log messages
 * @param {Function} fn - Async function to retry
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=3] - Max number of attempts
 * @param {number} [opts.baseDelayMs=1000] - Base delay in ms (doubles each retry)
 * @param {Function} [opts.onRetry] - Called with (error, attempt, delay) before each retry wait
 * @returns {Promise<*>} Result of fn()
 */
async function withRetry(label, fn, opts) {
  const maxRetries = (opts && opts.maxRetries) || DEFAULT_MAX_RETRIES;
  const baseDelayMs = (opts && opts.baseDelayMs) || DEFAULT_BASE_DELAY_MS;
  const onRetry = opts && opts.onRetry;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      if (onRetry) {
        onRetry(err, attempt, delay);
      }
      await sleep(delay);
    }
  }
}

module.exports = { withRetry, sleep };
