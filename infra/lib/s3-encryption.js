'use strict';

/**
 * Shared S3 SSE-KMS encryption parameters.
 * All S3 PutObject calls must include these to comply with bucket policies
 * that deny unencrypted uploads (NIST CSF 2.0 PR.DS-10).
 */

const KMS_KEY_ALIAS = process.env.KMS_KEY_ALIAS || 'alias/hackathon26-cmk';

const SSE_PARAMS = {
  ServerSideEncryption: 'aws:kms',
  SSEKMSKeyId: KMS_KEY_ALIAS,
};

/**
 * Merge SSE-KMS params into an existing PutObject params object.
 * @param {object} params - PutObjectCommand input
 * @returns {object} params with SSE fields added
 */
function withEncryption(params) {
  return Object.assign({}, params, SSE_PARAMS);
}

module.exports = { SSE_PARAMS, withEncryption, KMS_KEY_ALIAS };
