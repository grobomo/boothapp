'use strict';

/**
 * Shared S3 SSE-KMS encryption parameters.
 * All S3 PutObject calls must include these to comply with bucket policies
 * that deny unencrypted uploads (NIST CSF 2.0 PR.DS-10).
 */

const KMS_KEY_ALIAS = process.env.KMS_KEY_ALIAS || '';

const SSE_PARAMS = KMS_KEY_ALIAS
  ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: KMS_KEY_ALIAS }
  : { ServerSideEncryption: 'AES256' };

/**
 * Merge SSE-KMS params into an existing PutObject params object.
 * @param {object} params - PutObjectCommand input
 * @returns {object} params with SSE fields added
 */
function withEncryption(params) {
  return Object.assign({}, params, SSE_PARAMS);
}

module.exports = { SSE_PARAMS, withEncryption, KMS_KEY_ALIAS };
