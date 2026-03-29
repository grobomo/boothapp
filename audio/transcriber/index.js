'use strict';

/**
 * BoothApp Audio Transcriber — CLI entry point
 *
 * Usage:
 *   node index.js <session-id>
 *   SESSION_ID=<id> node index.js
 *
 * Environment:
 *   S3_BUCKET          - S3 bucket name (required)
 *   SESSION_ID         - Session ID (or pass as CLI arg)
 *   SE_SPEAKER_LABEL   - AWS Transcribe label for SE speaker (default: spk_0)
 *   AWS_REGION         - AWS region (default: us-east-1)
 */

const { S3Client } = require('@aws-sdk/client-s3');
const { TranscribeClient } = require('@aws-sdk/client-transcribe');

const { makeJobName, startTranscriptionJob, waitForJob, getRawTranscript, cleanupRaw } = require('./transcribe');
const { convertTranscript } = require('./convert');
const { uploadTranscript } = require('./upload');

/**
 * Validate and return configuration from environment / CLI args.
 * @returns {{ bucket: string, sessionId: string, seSpeakerLabel: string, region: string }}
 */
function getConfig() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3_BUCKET environment variable is required');
  }

  const sessionId = process.argv[2] || process.env.SESSION_ID;
  if (!sessionId) {
    throw new Error('Session ID is required: pass as CLI arg or SESSION_ID env var');
  }

  const seSpeakerLabel = process.env.SE_SPEAKER_LABEL || 'spk_0';
  const region = process.env.AWS_REGION || 'us-east-1';

  return { bucket, sessionId, seSpeakerLabel, region };
}

async function main() {
  let config;
  try {
    config = getConfig();
  } catch (err) {
    console.error(`[transcriber] Fatal error: ${err.message}`);
    process.exit(1);
  }

  const { bucket, sessionId, seSpeakerLabel, region } = config;

  const s3Client = new S3Client({
    region,
    credentials: {
      // Uses the AWS profile "hackathon" via environment or shared credentials
    },
  });

  const transcribeClient = new TranscribeClient({ region });

  const jobName = makeJobName(sessionId);
  let outputKey = null;

  try {
    console.log(`[transcriber] Starting transcription for session: ${sessionId}`);
    console.log(`[transcriber] Job name: ${jobName}`);

    outputKey = await startTranscriptionJob(transcribeClient, { bucket, sessionId, jobName });
    console.log(`[transcriber] Transcription job started. Raw output key: ${outputKey}`);

    console.log(`[transcriber] Waiting for job to complete (polling every 10s, timeout 15min)...`);
    await waitForJob(transcribeClient, jobName);
    console.log(`[transcriber] Transcription job completed.`);

    console.log(`[transcriber] Fetching raw transcript from S3...`);
    const raw = await getRawTranscript(s3Client, bucket, outputKey);
    console.log(`[transcriber] Raw transcript fetched. Converting...`);

    const transcript = convertTranscript(raw, sessionId, seSpeakerLabel);
    console.log(`[transcriber] Conversion complete. Entries: ${transcript.entries.length}, Duration: ${transcript.duration_seconds}s`);

    const key = await uploadTranscript(s3Client, bucket, sessionId, transcript);
    console.log(`[transcriber] Transcript uploaded to s3://${bucket}/${key}`);
  } catch (err) {
    console.error(`[transcriber] Fatal error: ${err.message}`);
    process.exit(1);
  } finally {
    if (outputKey) {
      console.log(`[transcriber] Cleaning up temporary files...`);
      await cleanupRaw(s3Client, transcribeClient, bucket, outputKey, jobName);
      console.log(`[transcriber] Cleanup done.`);
    }
  }
}

main();
