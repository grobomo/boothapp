'use strict';

/**
 * Error classification and retry logic for the analysis pipeline.
 *
 * Transient errors (Bedrock throttling, service unavailable) are retryable.
 * Permanent errors (bad input, access denied) are not.
 */

const RETRYABLE_ERROR_CODES = new Set([
  'ThrottlingException',
  'ServiceUnavailableException',
  'TooManyRequestsException',
  'RequestTimeout',
  'InternalServerException',
]);

const RETRY_DELAYS_MS = [5000, 15000, 45000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

class PipelineError extends Error {
  constructor(message, { code, stage, retryable, cause } = {}) {
    super(message);
    this.name = 'PipelineError';
    this.code = code || 'UnknownError';
    this.stage = stage || 'unknown';
    this.retryable = retryable !== undefined ? retryable : false;
    this.cause = cause || null;
  }
}

/**
 * Classify an AWS/Bedrock error as retryable or permanent.
 */
function classifyError(err, stage) {
  const code = err.code || err.name || err.__type || '';
  const retryable = RETRYABLE_ERROR_CODES.has(code);

  return new PipelineError(err.message || String(err), {
    code,
    stage,
    retryable,
    cause: err,
  });
}

/**
 * Get the delay in ms for a given retry attempt (0-indexed).
 * Returns null if no more retries are available.
 */
function getRetryDelay(attempt) {
  if (attempt < 0 || attempt >= RETRY_DELAYS_MS.length) return null;
  return RETRY_DELAYS_MS[attempt];
}

/**
 * Sleep for the specified duration.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with exponential backoff retry.
 *
 * @param {Function} fn - Async function to execute
 * @param {string} stage - Pipeline stage name for error context
 * @param {object} [options] - Options
 * @param {Function} [options.logger] - Log function (default: console.log)
 * @param {string} [options.sessionId] - Session ID for log context
 * @param {Function} [options.sleepFn] - Sleep function (for testing)
 * @returns {Promise<*>} Result of fn()
 * @throws {PipelineError} After all retries exhausted
 */
async function withRetry(fn, stage, options = {}) {
  const logger = options.logger || console.log;
  const sessionId = options.sessionId || 'unknown';
  const sleepFn = options.sleepFn || sleep;

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = classifyError(err, stage);

      if (!lastError.retryable) {
        throw lastError;
      }

      const delay = getRetryDelay(attempt);
      if (delay === null) {
        break;
      }

      logger(
        `[retry] session=${sessionId} stage=${stage} attempt=${attempt + 1}/${MAX_RETRIES} ` +
        `code=${lastError.code} delay=${delay}ms`
      );

      await sleepFn(delay);
    }
  }

  lastError.message = `All ${MAX_RETRIES} retries exhausted: ${lastError.message}`;
  throw lastError;
}

module.exports = {
  PipelineError,
  classifyError,
  getRetryDelay,
  withRetry,
  sleep,
  RETRYABLE_ERROR_CODES,
  RETRY_DELAYS_MS,
  MAX_RETRIES,
};
