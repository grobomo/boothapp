'use strict';

/**
 * s3-upload.js — Upload audio recording + transcript to S3 session folder.
 *
 * Uploads:
 *   - recording.wav  -> sessions/<id>/audio/recording.wav   (multipart if >100MB)
 *   - transcript.json -> sessions/<id>/transcript/transcript.json
 *
 * Retries each upload up to 3 times with exponential backoff.
 * Updates metadata.json to set audio_uploaded: true after success.
 */

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { SSE_PARAMS } = require('../../infra/lib/s3-encryption');

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Create an S3 client using standard config.
 * @param {string} [region]
 * @returns {S3Client}
 */
function createS3Client(region) {
  return new S3Client({ region: region || process.env.AWS_REGION || 'us-east-1' });
}

/**
 * Sleep for ms milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload a file to S3 with retry logic.
 * Uses multipart upload for files over MULTIPART_THRESHOLD.
 *
 * @param {S3Client} s3
 * @param {string} bucket
 * @param {string} key - S3 object key
 * @param {string} filePath - local file path
 * @param {string} contentType
 * @returns {Promise<void>}
 */
async function uploadFileWithRetry(s3, bucket, key, filePath, contentType) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (fileSize > MULTIPART_THRESHOLD) {
        // Multipart upload for large files
        const upload = new Upload({
          client: s3,
          params: {
            Bucket: bucket,
            Key: key,
            ContentType: contentType,
            Body: fs.createReadStream(filePath),
            ...SSE_PARAMS,
          },
          queueSize: 4,
          partSize: 10 * 1024 * 1024, // 10MB parts
        });

        upload.on('httpUploadProgress', (progress) => {
          const pct = progress.loaded && fileSize
            ? Math.round((progress.loaded / fileSize) * 100)
            : '?';
          process.stderr.write(`\r  [upload] ${key}: ${pct}% (part ${progress.part || '?'})`);
        });

        await upload.done();
        process.stderr.write('\n');
      } else {
        // Single PUT for smaller files
        const body = fs.readFileSync(filePath);
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          Body: body,
          ...SSE_PARAMS,
        }));
      }
      return; // success
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Failed to upload ${key} after ${MAX_RETRIES} attempts: ${err.message}`);
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      process.stderr.write(`  [upload] Attempt ${attempt} failed for ${key}: ${err.message}. Retrying in ${delay}ms...\n`);
      await sleep(delay);
    }
  }
}

/**
 * Upload a JSON object to S3 with retry logic.
 *
 * @param {S3Client} s3
 * @param {string} bucket
 * @param {string} key
 * @param {object} data
 * @returns {Promise<void>}
 */
async function uploadJsonWithRetry(s3, bucket, key, data) {
  const body = JSON.stringify(data, null, 2);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: 'application/json',
        Body: body,
        ...SSE_PARAMS,
      }));
      return;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Failed to upload ${key} after ${MAX_RETRIES} attempts: ${err.message}`);
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      process.stderr.write(`  [upload] Attempt ${attempt} failed for ${key}: ${err.message}. Retrying in ${delay}ms...\n`);
      await sleep(delay);
    }
  }
}

/**
 * Fetch and update metadata.json in S3 to mark audio as uploaded.
 *
 * @param {S3Client} s3
 * @param {string} bucket
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function markAudioUploaded(s3, bucket, sessionId) {
  const metaKey = `sessions/${sessionId}/metadata.json`;

  // Fetch current metadata
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: metaKey }));
  const bodyStr = await resp.Body.transformToString();
  const metadata = JSON.parse(bodyStr);

  // Update
  metadata.audio_uploaded = true;
  metadata.audio_uploaded_at = new Date().toISOString();

  // Write back
  await uploadJsonWithRetry(s3, bucket, metaKey, metadata);
}

/**
 * Upload session audio and transcript files to S3.
 *
 * @param {object} options
 * @param {string} options.sessionId - session ID
 * @param {string} options.outputDir - local directory containing recording.wav and optionally transcript.json
 * @param {string} options.bucket - S3 bucket name
 * @param {string} [options.region] - AWS region
 * @returns {Promise<{ audioKey: string, transcriptKey: string|null }>}
 */
async function uploadSessionAudio({ sessionId, outputDir, bucket, region }) {
  const s3 = createS3Client(region);

  const wavPath = path.join(outputDir, 'recording.wav');
  const transcriptPath = path.join(outputDir, 'transcript.json');

  if (!fs.existsSync(wavPath)) {
    throw new Error(`Recording file not found: ${wavPath}`);
  }

  const audioKey = `sessions/${sessionId}/audio/recording.wav`;
  const transcriptKey = `sessions/${sessionId}/transcript/transcript.json`;

  // Upload WAV
  console.log(`[s3-upload] Uploading recording.wav (${(fs.statSync(wavPath).size / 1024 / 1024).toFixed(1)}MB)...`);
  await uploadFileWithRetry(s3, bucket, audioKey, wavPath, 'audio/wav');
  console.log(`[s3-upload] Uploaded -> s3://${bucket}/${audioKey}`);

  // Upload transcript if it exists locally
  let uploadedTranscriptKey = null;
  if (fs.existsSync(transcriptPath)) {
    console.log('[s3-upload] Uploading transcript.json...');
    await uploadFileWithRetry(s3, bucket, transcriptKey, transcriptPath, 'application/json');
    console.log(`[s3-upload] Uploaded -> s3://${bucket}/${transcriptKey}`);
    uploadedTranscriptKey = transcriptKey;
  } else {
    console.log('[s3-upload] No local transcript.json found (may have been uploaded by transcriber pipeline).');
  }

  // Mark metadata
  try {
    await markAudioUploaded(s3, bucket, sessionId);
    console.log('[s3-upload] metadata.json updated: audio_uploaded = true');
  } catch (err) {
    console.error(`[s3-upload] Warning: failed to update metadata.json: ${err.message}`);
    // Non-fatal: the files are uploaded, metadata update is best-effort
  }

  return { audioKey, transcriptKey: uploadedTranscriptKey };
}

module.exports = {
  uploadSessionAudio,
  uploadFileWithRetry,
  uploadJsonWithRetry,
  markAudioUploaded,
  createS3Client,
  MULTIPART_THRESHOLD,
  MAX_RETRIES,
};
