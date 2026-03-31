#!/usr/bin/env node
'use strict';

/**
 * recorder.js — BoothApp audio recorder
 *
 * Session-triggered ffmpeg audio capture for trade show demos.
 * Polls S3 for session start/stop, records USB mic to WAV.
 *
 * Usage:
 *   node recorder.js
 *
 * Required env vars:
 *   S3_BUCKET    — S3 bucket name (e.g. boothapp-sessions-123456789)
 *   SESSION_ID   — session ID to record (e.g. A726594)
 *
 * Optional env vars:
 *   AUDIO_DEVICE        — override auto-detected mic device name
 *   POLL_INTERVAL_MS    — S3 poll interval in ms (default: 2000)
 *   AWS_REGION          — AWS region (default: us-east-1)
 *   AWS_PROFILE         — AWS profile (default: hackathon)
 *   OUTPUT_DIR          — local output dir (default: ./output/<session_id>)
 */

const path = require('path');
const { detectMic } = require('./lib/device-detect');
const { SessionPoller } = require('./lib/session-poller');
const { FfmpegRecorder } = require('./lib/ffmpeg-recorder');
const { uploadSessionAudio } = require('./lib/s3-upload');

const SESSION_ID = process.env.SESSION_ID;
const S3_BUCKET = process.env.S3_BUCKET;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function die(msg) {
  console.error(`[ERROR] ${msg}`);
  process.exit(1);
}

async function main() {
  if (!S3_BUCKET) die('S3_BUCKET env var is required');
  if (!SESSION_ID) die('SESSION_ID env var is required');

  // Step 1: detect mic
  log('Detecting USB/wireless microphone...');
  let device;
  try {
    device = await detectMic();
    log(`Using audio device: "${device}"`);
  } catch (err) {
    die(err.message);
  }

  // Step 2: set up output path
  const outputDir = process.env.OUTPUT_DIR || path.join(__dirname, 'output', SESSION_ID);
  const outputPath = path.join(outputDir, 'recording.wav');

  // Step 3: set up recorder (don't start yet — wait for session start signal)
  const recorder = new FfmpegRecorder({ device, outputPath });

  recorder.on('started', ({ outputPath: out }) => {
    log(`Recording started -> ${out}`);
  });

  recorder.on('stopped', ({ code, signal }) => {
    log(`Recording stopped (code=${code}, signal=${signal}) -> ${outputPath}`);
  });

  recorder.on('error', (err) => {
    log(`Recorder error: ${err.message}`);
  });

  recorder.on('ffmpeg-output', (text) => {
    // Uncomment for verbose ffmpeg debug output:
    // process.stderr.write(text);
  });

  // Step 4: set up session poller
  const poller = new SessionPoller({ bucket: S3_BUCKET, sessionId: SESSION_ID });

  poller.on('start', async (metadata) => {
    log(`Session ${SESSION_ID} started (visitor: ${metadata.visitor_name || 'unknown'})`);
    try {
      await recorder.start();
    } catch (err) {
      die(`Failed to start recording: ${err.message}`);
    }
  });

  poller.on('stop', async ({ reason }) => {
    log(`Session stop signal received (reason: ${reason})`);
    if (recorder.isRecording) {
      log('Stopping recorder...');
      await recorder.stop();
    }
    poller.stop();

    // Upload recording + transcript to S3
    log('Uploading session audio to S3...');
    try {
      const result = await uploadSessionAudio({
        sessionId: SESSION_ID,
        outputDir,
        bucket: S3_BUCKET,
      });
      log(`Uploaded audio -> s3://${S3_BUCKET}/${result.audioKey}`);
      if (result.transcriptKey) {
        log(`Uploaded transcript -> s3://${S3_BUCKET}/${result.transcriptKey}`);
      }
    } catch (err) {
      log(`Upload failed (non-fatal): ${err.message}`);
    }

    log('Done.');
    process.exit(0);
  });

  poller.on('error', (err) => {
    log(`Poller error: ${err.message}`);
  });

  // Step 5: handle SIGINT / SIGTERM (Ctrl+C or system shutdown)
  async function shutdown(signal) {
    log(`${signal} received — stopping cleanly...`);
    poller.stop();
    if (recorder.isRecording) {
      await recorder.stop();
      log(`Recording saved to ${outputPath}`);

      // Best-effort upload before exit
      log('Uploading session audio to S3...');
      try {
        await uploadSessionAudio({
          sessionId: SESSION_ID,
          outputDir,
          bucket: S3_BUCKET,
        });
        log('Upload complete.');
      } catch (err) {
        log(`Upload failed (non-fatal): ${err.message}`);
      }
    }
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Step 6: start polling
  log(`Waiting for session ${SESSION_ID} to start (polling ${S3_BUCKET} every ${poller.intervalMs}ms)...`);
  poller.start();
}

main().catch((err) => die(err.message));
