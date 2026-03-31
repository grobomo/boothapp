'use strict';

// ---------------------------------------------------------------------------
// Error classification for the analysis pipeline.
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
 * Classify an error into a category for retry decisions and error reporting.
 * Returns { type, retryable, message, code, detail }.
 */
function classifyError(err) {
  const code = err.code || err.Code || err.name || '';
  const msg = err.message || String(err);
  const statusCode = err.$metadata?.httpStatusCode || err.statusCode;

  // Pipeline timeout
  if (code === 'PIPELINE_TIMEOUT') {
    return {
      type: 'timeout',
      retryable: false,
      message: msg,
      code,
      detail: null,
    };
  }

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

  // Network-level transient
  if (NETWORK_CODES.has(code)) {
    return {
      type: 'network',
      retryable: true,
      message: `Network error (${code}): ${msg}`,
      code,
      detail: null,
    };
  }

  // Service throttling
  if (TRANSIENT_CODES.has(code) || statusCode === 429 || statusCode === 503) {
    return {
      type: 'throttling',
      retryable: true,
      message: `Transient failure (${code}): ${msg}`,
      code,
      detail: null,
    };
  }

  // Bedrock model errors (retryable)
  if (code === 'ModelNotReadyException' || code === 'ModelTimeoutException') {
    return {
      type: 'bedrock_model',
      retryable: true,
      message: `Bedrock model error: ${msg}`,
      code,
      detail: null,
    };
  }

  // Bedrock validation (not retryable)
  if (code === 'ValidationException' || code === 'ModelErrorException') {
    return {
      type: 'bedrock_validation',
      retryable: false,
      message: `Bedrock validation error: ${msg}`,
      code,
      detail: null,
    };
  }

  // Unknown -- not retryable by default
  return {
    type: 'unknown',
    retryable: false,
    message: msg,
    code: code || null,
    detail: null,
  };
}

module.exports = { classifyError, TRANSIENT_CODES, S3_ACCESS_CODES, NETWORK_CODES };
