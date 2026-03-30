#!/usr/bin/env node
// pipeline-run.js — Analysis pipeline entry point
//
// Called by analysis/lib/pipeline.js once a session is claimed:
//   node pipeline-run.js <sessionId> <bucket>
//
// Step 1 (this file): fetch clicks + transcript from S3, correlate them,
//   write output/timeline.json back to S3.
//
// Future steps (ana-03, ana-04) will be chained here once implemented.

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const { correlate } = require('./lib/correlator');
const { getJson } = require('./lib/s3');
const { sendNotification } = require('./lib/notify');
const {
  S3Client,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');

const [, , sessionId, bucket] = process.argv;

if (!sessionId || !bucket) {
  console.error('Usage: pipeline-run.js <sessionId> <bucket>');
  process.exit(1);
}

const REGION = process.env.AWS_REGION || 'us-east-1';

function log(msg) {
  console.log(`[pipeline:${sessionId}] ${new Date().toISOString()} ${msg}`);
}

async function putJson(key, data) {
  const client = new S3Client({ region: REGION });
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  }));
}

async function run() {
  log('Starting analysis pipeline');

  // --- Step 1: Fetch session data from S3 ---
  log('Fetching metadata, clicks, transcript from S3...');
  const [metadata, clicks, transcript] = await Promise.all([
    getJson(bucket, `sessions/${sessionId}/metadata.json`),
    getJson(bucket, `sessions/${sessionId}/clicks/clicks.json`),
    getJson(bucket, `sessions/${sessionId}/transcript/transcript.json`),
  ]);

  log(`Loaded: ${clicks.events?.length ?? 0} clicks, ${transcript.entries?.length ?? 0} transcript entries`);

  // --- Step 2: Correlate into unified timeline ---
  log('Correlating timestamps...');
  const timeline = correlate(metadata, clicks, transcript);

  log(`Timeline built: ${timeline.event_count} events (${timeline.click_count} clicks, ${timeline.speech_count} speech)`);

  // --- Step 3: Write timeline.json to S3 ---
  const timelineKey = `sessions/${sessionId}/output/timeline.json`;
  log(`Writing ${timelineKey}...`);
  await putJson(timelineKey, timeline);

  log('Done — timeline.json written to S3');

  // --- Step 4: Run Claude analysis (ana-03) ---
  log('Starting Claude analysis (analyze.py)...');
  const analyzeScript = path.join(__dirname, 'analyze.py');
  const sessionS3Path = `s3://${bucket}/sessions/${sessionId}`;
  try {
    execFileSync('python3', [analyzeScript, sessionS3Path], {
      stdio: 'inherit',
      timeout: 300_000, // 5 minute timeout
    });
    log('Claude analysis complete — summary.json and follow-up.json written to S3');
  } catch (err) {
    // Log but don't fail the pipeline — timeline is already written
    log(`WARNING: Claude analysis failed: ${err.message}`);
    return;
  }

  // --- Step 5: Render HTML report ---
  log('Rendering HTML report (render-report.js)...');
  const renderScript = path.join(__dirname, 'render-report.js');
  try {
    execFileSync('node', [renderScript, sessionS3Path], {
      stdio: 'inherit',
      timeout: 60_000, // 1 minute timeout
    });
    log('HTML report complete — summary.html written to S3');
  } catch (err) {
    log(`WARNING: HTML report rendering failed: ${err.message}`);
  }

  // --- Step 5b: Generate email-ready HTML ---
  log('Generating email-ready HTML (email-report.js)...');
  const emailScript = path.join(__dirname, 'email-report.js');
  try {
    execFileSync('node', [emailScript, sessionS3Path], {
      stdio: 'inherit',
      timeout: 60_000,
    });
    log('Email report complete — email-ready.html written to S3');
  } catch (err) {
    log(`WARNING: Email report generation failed: ${err.message}`);
  }

  // --- Step 6: Send completion notification ---
  log('Sending completion notification...');
  try {
    const [summary, followUp] = await Promise.all([
      getJson(bucket, `sessions/${sessionId}/output/summary.json`),
      getJson(bucket, `sessions/${sessionId}/output/follow-up.json`),
    ]);
    await sendNotification({ sessionId, bucket, metadata, summary, followUp, dryRun: false });
    log('Notification sent');
  } catch (err) {
    log(`WARNING: Notification failed: ${err.message}`);
  }
}

run().catch((err) => {
  console.error(`[pipeline:${sessionId}] FATAL: ${err.message}`);
  process.exit(1);
});
