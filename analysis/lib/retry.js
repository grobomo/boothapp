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
 * @param {number} [opts.baseDelayMs=1000] - Base delay in ms (multiplied each retry)
 * @param {number} [opts.multiplier=2] - Backoff multiplier (e.g. 3 gives 5s/15s/45s with base 5000)
 * @param {Function} [opts.onRetry] - Called with (error, attempt, delay) before each retry wait
 * @param {Function} [opts.isRetryable] - If provided, only retry when this returns true for the error
 * @returns {Promise<*>} Result of fn()
 */
async function withRetry(label, fn, opts) {
  const maxRetries = (opts && opts.maxRetries) || DEFAULT_MAX_RETRIES;
  const baseDelayMs = (opts && opts.baseDelayMs) || DEFAULT_BASE_DELAY_MS;
  const multiplier = (opts && opts.multiplier) || 2;
  const onRetry = opts && opts.onRetry;
  const isRetryable = opts && opts.isRetryable;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const canRetry = attempt < maxRetries && (!isRetryable || isRetryable(err));
      if (!canRetry) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(multiplier, attempt - 1);
      if (onRetry) {
        onRetry(err, attempt, delay);
      }
      await sleep(delay);
    }
  }
}

module.exports = { withRetry, sleep };
