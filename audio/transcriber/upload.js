'use strict';

const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { SSE_PARAMS } = require('../../infra/lib/s3-encryption');

/**
 * Upload transcript.json to S3.
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucket
 * @param {string} sessionId
 * @param {object} transcript - transcript.json object
 * @returns {Promise<string>} the S3 key where the file was written
 */
async function uploadTranscript(s3Client, bucket, sessionId, transcript) {
  const key = `sessions/${sessionId}/transcript/transcript.json`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: 'application/json',
    Body: JSON.stringify(transcript, null, 2),
    ...SSE_PARAMS,
  });

  await s3Client.send(command);
  return key;
}

module.exports = { uploadTranscript };
