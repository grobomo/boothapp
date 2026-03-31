'use strict';

/**
 * Writes structured error JSON to a session's output directory in S3.
 */

/**
 * Build a structured error object for writing to S3.
 *
 * @param {import('./errors').PipelineError} err
 * @param {string} sessionId
 * @returns {object} Structured error JSON
 */
function buildErrorJson(err, sessionId) {
  return {
    session_id: sessionId,
    type: err.code || 'UnknownError',
    stage: err.stage || 'unknown',
    message: err.message,
    retryable: Boolean(err.retryable),
    failed_at: new Date().toISOString(),
  };
}

/**
 * Upload error.json to the session's output/ prefix in S3.
 *
 * @param {object} s3Client - AWS S3 client
 * @param {string} bucket - S3 bucket name
 * @param {string} sessionId - Session identifier
 * @param {object} errorData - Error object from buildErrorJson
 */
async function writeErrorToS3(s3Client, bucket, sessionId, errorData) {
  const key = `sessions/${sessionId}/output/error.json`;
  await s3Client.putObject({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(errorData, null, 2),
    ContentType: 'application/json',
  }).promise();
}

module.exports = { buildErrorJson, writeErrorToS3 };
