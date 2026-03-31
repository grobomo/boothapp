'use strict';

// ---------------------------------------------------------------------------
// Error classification and retry helpers for the analysis pipeline.
// ---------------------------------------------------------------------------

const TRANSIENT_CODES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailableException',
  'InternalServerException',
  'RequestTimeout',
]);

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
]);

const S3_ACCESS_CODES = new Set([
  'AccessDenied',
  'AllAccessDisabled',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
]);

/**
 * Classify an error into a category the dashboard can display.
 * Returns { type, retryable, message, code, detail }.
 */
function classifyError(err) {
  const code = err.code || err.Code || err.name || '';
  const msg = err.message || String(err);
  const statusCode = err.$metadata?.httpStatusCode || err.statusCode;

  // S3 access / auth errors
  if (S3_ACCESS_CODES.has(code) || statusCode === 403) {
    return {
      type: 's3_access_denied',
      retryable: false,
      message: `S3 access denied: ${msg}`,
      code,
      detail: err.Key || err.Bucket || null,
    };
  }

  // Missing object / file
  if (code === 'NoSuchKey' || code === 'NotFound' || code === 'ENOENT' || statusCode === 404) {
    return {
      type: 'missing_file',
      retryable: false,
      message: `File not found: ${msg}`,
      code,
      detail: err.Key || err.path || null,
    };
  }

  // Network-level transient (check before generic throttling)
  if (NETWORK_CODES.has(code)) {
    return {
      type: 'network',
      retryable: true,
      message: `Network error (${code}): ${msg}`,
      code,
      detail: null,
    };
  }

  // Bedrock / service throttling
  if (TRANSIENT_CODES.has(code) || statusCode === 429 || statusCode === 503) {
    return {
      type: 'throttling',
      retryable: true,
      message: `Transient failure (${code}): ${msg}`,
      code,
      detail: null,
    };
  }

  // Bedrock model errors
  if (code === 'ModelNotReadyException' || code === 'ModelTimeoutException') {
    return {
      type: 'bedrock_model',
      retryable: true,
      message: `Bedrock model error: ${msg}`,
      code,
      detail: null,
    };
  }

  // Bedrock validation (bad prompt, too long, etc.) -- not retryable
  if (code === 'ValidationException' || code === 'ModelErrorException') {
    return {
      type: 'bedrock_validation',
      retryable: false,
      message: `Bedrock validation error: ${msg}`,
      code,
      detail: null,
    };
  }

  // Fallback -- unknown, not retryable by default
  return {
    type: 'unknown',
    retryable: false,
    message: msg,
    code: code || null,
    detail: null,
  };
}

/**
 * Retry `fn` with exponential backoff.  Only retries when classifyError says
 * the error is retryable.
 *
 * @param {Function} fn        - async function to call
 * @param {Object}   opts
 * @param {number}   opts.maxRetries  - default 3
 * @param {number}   opts.baseDelayMs - default 1000
 * @param {number}   opts.maxDelayMs  - default 30000
 * @param {Function} opts.onRetry     - called with (classified, attempt, delayMs)
 * @returns {Promise<*>} result of fn()
 */
async function retryWithBackoff(fn, opts = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    onRetry = () => {},
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const classified = classifyError(err);

      if (!classified.retryable || attempt >= maxRetries) {
        throw err;
      }

      const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) * jitter, maxDelayMs);
      onRetry(classified, attempt + 1, Math.round(delay));
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

module.exports = { classifyError, retryWithBackoff, TRANSIENT_CODES, S3_ACCESS_CODES, NETWORK_CODES };
