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

const { correlate } = require('./lib/correlator');
const { getJson } = require('./lib/s3');
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

  // ana-03 (Claude analysis) will read timeline.json and produce summary.json
  // ana-04 (HTML report) will produce summary.html
  // Both will be invoked here once implemented.
}

run().catch((err) => {
  console.error(`[pipeline:${sessionId}] FATAL: ${err.message}`);
  process.exit(1);
});
