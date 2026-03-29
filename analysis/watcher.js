#!/usr/bin/env node
// Session completion watcher
// Polls S3 every 30s for sessions that are ready for analysis.
//
// A session is complete when ALL three conditions hold:
//   1. sessions/<id>/metadata.json  has status == 'completed'
//   2. sessions/<id>/clicks/clicks.json  exists
//   3. sessions/<id>/transcript/transcript.json  exists
//
// When complete, claims the session (writes output/.analysis-claimed to S3)
// and triggers the analysis pipeline. Already-claimed sessions are skipped.
//
// Usage:
//   S3_BUCKET=my-bucket node analysis/watcher.js
//
// Environment variables:
//   S3_BUCKET              (required) S3 bucket name
//   AWS_REGION             (optional, default: us-east-1)
//   POLL_INTERVAL_SECONDS  (optional, default: 30)

'use strict';

const { listSessions, isSessionComplete, isAlreadyClaimed, writeMarker } = require('./lib/s3');
const { triggerPipeline } = require('./lib/pipeline');

const BUCKET = process.env.S3_BUCKET;
const POLL_INTERVAL_MS = (parseInt(process.env.POLL_INTERVAL_SECONDS, 10) || 30) * 1000;

// In-memory set of sessions already dispatched this process run.
// S3 marker (output/.analysis-claimed) handles cross-restart deduplication.
const dispatched = new Set();

function log(msg) {
  console.log(`[watcher] ${new Date().toISOString()} ${msg}`);
}

async function pollOnce() {
  let sessions;
  try {
    sessions = await listSessions(BUCKET);
  } catch (err) {
    log(`ERROR listing sessions: ${err.message}`);
    return;
  }

  log(`Checking ${sessions.length} session(s)...`);

  // Check all sessions concurrently — each check is independent
  await Promise.all(sessions.map(async (sessionId) => {
    if (dispatched.has(sessionId)) return;

    try {
      // Fast-path: skip if already claimed in S3 (handles restarts)
      if (await isAlreadyClaimed(BUCKET, sessionId)) {
        dispatched.add(sessionId); // cache to skip S3 check next poll
        return;
      }

      const complete = await isSessionComplete(BUCKET, sessionId);
      if (!complete) {
        log(`  ${sessionId}: incomplete (waiting for data)`);
        return;
      }

      log(`  ${sessionId}: COMPLETE — claiming and triggering analysis`);

      // Write claim marker before launching pipeline to prevent double-dispatch
      // on concurrent watcher instances or rapid restarts
      await writeMarker(BUCKET, sessionId, {
        claimed_at: new Date().toISOString(),
        claimed_by: process.env.HOSTNAME || 'watcher',
      });
      dispatched.add(sessionId);

      // Trigger pipeline (fire-and-forget — errors are logged, not fatal)
      triggerPipeline(sessionId, BUCKET)
        .then((result) => log(`  ${sessionId}: pipeline finished — ${result.status}`))
        .catch((err) => log(`  ${sessionId}: pipeline ERROR — ${err.message}`));

    } catch (err) {
      log(`  ${sessionId}: ERROR checking session — ${err.message}`);
    }
  }));
}

async function run() {
  if (!BUCKET) {
    console.error('[watcher] ERROR: S3_BUCKET environment variable is required');
    process.exit(1);
  }

  log(`Starting — bucket=${BUCKET} poll_interval=${POLL_INTERVAL_MS / 1000}s`);

  // Run immediately on start, then on interval
  await pollOnce();
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

run().catch((err) => {
  console.error(`[watcher] FATAL: ${err.message}`);
  process.exit(1);
});
