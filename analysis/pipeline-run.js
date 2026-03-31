#!/usr/bin/env node
// pipeline-run.js — Analysis pipeline entry point
//
// Called by analysis/lib/pipeline.js once a session is claimed:
//   node pipeline-run.js <sessionId> <bucket>
//
// Steps:
//   1. Fetch clicks + transcript from S3
//   2. Correlate into unified timeline
//   3. Write timeline.json to S3
//   4. Run Claude analysis (analyze.py)
//   5. Render HTML report
//
// Error handling:
//   - Each step wrapped in try-catch
//   - S3/Bedrock calls retry with exponential backoff (3 attempts)
//   - 120s total pipeline timeout
//   - Errors collected and written to output/errors.json
//   - Fallback summary.json on analysis failure

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const { correlate } = require('./lib/correlator');
const { getJson, listObjects } = require('./lib/s3');
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
const PIPELINE_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function log(msg) {
  console.log(`[pipeline:${sessionId}] ${new Date().toISOString()} ${msg}`);
}

// --- Retry with exponential backoff ---
async function withRetry(label, fn) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        log(`${label}: failed after ${MAX_RETRIES} attempts — ${err.message}`);
        throw err;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      log(`${label}: attempt ${attempt}/${MAX_RETRIES} failed (${err.message}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- S3 write with retry ---
async function putJson(key, data) {
  await withRetry(`S3 PUT ${key}`, async () => {
    const client = new S3Client({ region: REGION });
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
    }));
  });
}

// --- Fallback summary for when analysis fails ---
function buildFallbackSummary(metadata, timeline) {
  return {
    session_id: sessionId,
    visitor_name: (metadata && metadata.visitor_name) || 'Unknown Visitor',
    demo_duration_minutes: timeline
      ? Math.round((timeline.duration_seconds || 0) / 60)
      : 0,
    products_shown: [],
    visitor_interests: [],
    recommended_follow_up: ['Review session recording manually'],
    key_moments: [],
    generated_at: new Date().toISOString(),
    fallback: true,
    fallback_reason: 'AI analysis unavailable — this is an auto-generated placeholder',
  };
}

async function run() {
  const errors = [];
  const startTime = Date.now();

  function checkTimeout(stepName) {
    const elapsed = Date.now() - startTime;
    if (elapsed > PIPELINE_TIMEOUT_MS) {
      throw new Error(`Pipeline timeout (${PIPELINE_TIMEOUT_MS}ms) exceeded during ${stepName}`);
    }
  }

  log('Starting analysis pipeline');

  // --- Step 1: Fetch session data from S3 ---
  let metadata, clicks, transcript, screenshots;
  try {
    checkTimeout('fetch');
    log('Fetching metadata, clicks, transcript, screenshots from S3...');
    [metadata, clicks, transcript] = await withRetry('S3 fetch session data', () =>
      Promise.all([
        getJson(bucket, `sessions/${sessionId}/metadata.json`),
        getJson(bucket, `sessions/${sessionId}/clicks/clicks.json`),
        getJson(bucket, `sessions/${sessionId}/transcript/transcript.json`),
      ])
    );
    // List screenshot files (non-fatal if none exist)
    try {
      const ssPrefix = `sessions/${sessionId}/screenshots/`;
      const ssObjects = await listObjects(bucket, ssPrefix);
      screenshots = ssObjects
        .filter(function(o) { return /\.(jpg|jpeg|png)$/i.test(o.Key); })
        .map(function(o) { return { file: o.Key, timestamp: o.LastModified ? new Date(o.LastModified).toISOString() : null }; });
      log(`Found ${screenshots.length} screenshots`);
    } catch (ssErr) {
      log(`WARNING: Could not list screenshots — ${ssErr.message}`);
      screenshots = [];
    }
    log(`Loaded: ${clicks.events?.length ?? 0} clicks, ${transcript.entries?.length ?? 0} transcript entries`);
  } catch (err) {
    errors.push({ step: 'fetch', error: err.message, timestamp: new Date().toISOString() });
    log(`FATAL: Failed to fetch session data — ${err.message}`);
    await writeErrors(errors);
    process.exit(1);
  }

  // --- Step 2: Correlate into unified timeline ---
  let timeline;
  try {
    checkTimeout('correlate');
    log('Correlating timestamps...');
    timeline = correlate(metadata, clicks, transcript, screenshots);
    var skippedNote = '';
    if (timeline.skipped_clicks > 0 || timeline.skipped_speech > 0) {
      skippedNote = `, skipped ${timeline.skipped_clicks} clicks + ${timeline.skipped_speech} speech`;
    }
    log(`Timeline built: ${timeline.event_count} events (${timeline.click_count} clicks, ${timeline.speech_count} speech), ${timeline.topics.length} topics, ${timeline.segments.length} segments${skippedNote}`);
  } catch (err) {
    errors.push({ step: 'correlate', error: err.message, timestamp: new Date().toISOString() });
    log(`ERROR: Correlation failed — ${err.message}`);
    // Continue with empty timeline so downstream steps can still produce a fallback
    timeline = { event_count: 0, click_count: 0, speech_count: 0, skipped_clicks: 0, skipped_speech: 0, timeline: [], duration_seconds: 0 };
  }

  // --- Step 3: Write timeline.json to S3 ---
  const timelineKey = `sessions/${sessionId}/output/timeline.json`;
  try {
    checkTimeout('write-timeline');
    log(`Writing ${timelineKey}...`);
    await putJson(timelineKey, timeline);
    log('Done — timeline.json written to S3');
  } catch (err) {
    errors.push({ step: 'write-timeline', error: err.message, timestamp: new Date().toISOString() });
    log(`ERROR: Failed to write timeline.json — ${err.message}`);
    // Non-fatal: continue to analysis
  }

  // --- Step 4: Run Claude analysis (ana-03) ---
  let analysisSucceeded = false;
  try {
    checkTimeout('analyze');
    log('Starting Claude analysis (analyze.py)...');
    const analyzeScript = path.join(__dirname, 'analyze.py');
    const sessionS3Path = `s3://${bucket}/sessions/${sessionId}`;
    const remainingMs = PIPELINE_TIMEOUT_MS - (Date.now() - startTime);
    const analyzeTimeout = Math.min(Math.max(remainingMs, 5000), 300_000);
    execFileSync('python3', [analyzeScript, sessionS3Path], {
      stdio: 'inherit',
      timeout: analyzeTimeout,
    });
    log('Claude analysis complete — summary.json and follow-up.json written to S3');
    analysisSucceeded = true;
  } catch (err) {
    errors.push({ step: 'analyze', error: err.message, timestamp: new Date().toISOString() });
    log(`WARNING: Claude analysis failed: ${err.message}`);
  }

  // --- Step 4b: Write fallback summary if analysis failed ---
  if (!analysisSucceeded) {
    try {
      log('Writing fallback summary...');
      const fallback = buildFallbackSummary(metadata, timeline);
      await putJson(`sessions/${sessionId}/output/summary.json`, fallback);
      await putJson(`sessions/${sessionId}/output/follow-up.json`, {
        visitor_email: '',
        priority: 'medium',
        sdr_notes: 'AI analysis was unavailable. Please review the session timeline manually.',
        tags: ['fallback'],
      });
      log('Fallback summary written to S3');
    } catch (err2) {
      errors.push({ step: 'fallback-summary', error: err2.message, timestamp: new Date().toISOString() });
      log(`ERROR: Failed to write fallback summary — ${err2.message}`);
    }
  }

  // --- Step 5: Render HTML report ---
  try {
    checkTimeout('render');
    log('Rendering HTML report (render-report.js)...');
    const renderScript = path.join(__dirname, 'render-report.js');
    const sessionS3Path = `s3://${bucket}/sessions/${sessionId}`;
    const remainingMs = PIPELINE_TIMEOUT_MS - (Date.now() - startTime);
    const renderTimeout = Math.min(Math.max(remainingMs, 5000), 60_000);
    execFileSync('node', [renderScript, sessionS3Path], {
      stdio: 'inherit',
      timeout: renderTimeout,
    });
    log('HTML report complete — summary.html written to S3');
  } catch (err) {
    errors.push({ step: 'render', error: err.message, timestamp: new Date().toISOString() });
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
  try {
    checkTimeout('notify');
    log('Sending completion notification...');
    const [summary, followUp] = await Promise.all([
      getJson(bucket, `sessions/${sessionId}/output/summary.json`),
      getJson(bucket, `sessions/${sessionId}/output/follow-up.json`),
    ]);
    await sendNotification({ sessionId, bucket, metadata, summary, followUp, dryRun: false });
    log('Notification sent');
  } catch (err) {
    errors.push({ step: 'notify', error: err.message, timestamp: new Date().toISOString() });
    log(`WARNING: Notification failed: ${err.message}`);
  }

  // --- Write errors.json if any errors occurred ---
  if (errors.length > 0) {
    await writeErrors(errors);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Pipeline finished in ${elapsed}s with ${errors.length} error(s)`);
}

async function writeErrors(errors) {
  const errorsKey = `sessions/${sessionId}/output/errors.json`;
  try {
    const payload = {
      session_id: sessionId,
      pipeline_run: new Date().toISOString(),
      error_count: errors.length,
      errors,
    };
    // Direct write (no retry wrapper to avoid infinite loops on write failure)
    const client = new S3Client({ region: REGION });
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: errorsKey,
      Body: JSON.stringify(payload, null, 2),
      ContentType: 'application/json',
    }));
    log(`Wrote ${errors.length} error(s) to ${errorsKey}`);
  } catch (writeErr) {
    // Last resort: log to stderr
    log(`FATAL: Could not write errors.json — ${writeErr.message}`);
    console.error(JSON.stringify(errors, null, 2));
  }
}

run().catch((err) => {
  console.error(`[pipeline:${sessionId}] FATAL: ${err.message}`);
  process.exit(1);
});
