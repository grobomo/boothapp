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
//   node analysis/watcher.js --test          (dry-run notification with sample data)
//
// Environment variables:
//   S3_BUCKET              (required) S3 bucket name
//   AWS_REGION             (required) AWS region (e.g. us-east-1)
//   AWS_ACCESS_KEY_ID      (required unless using instance role / AWS_PROFILE)
//   USE_BEDROCK            (optional) set to 1 to route LLM calls through Bedrock
//   ANALYSIS_MODEL         (required if USE_BEDROCK=1) Bedrock model ID
//   POLL_INTERVAL_SECONDS  (optional, default: 30)

'use strict';

const http = require('http');
const { listSessions, isSessionComplete, isAlreadyClaimed, writeMarker } = require('./lib/s3');
const { triggerPipeline } = require('./lib/pipeline');
const { sendNotification } = require('./lib/notify');
const { spawn } = require('child_process');
const path = require('path');
const health = require('./watcher-health');

// --test flag: run a dry notification with sample data and exit
if (process.argv.includes('--test')) {
  sendNotification({
    sessionId: 'TEST-DRY-RUN',
    bucket: 'none',
    metadata: {
      session_id: 'TEST-DRY-RUN',
      visitor_name: 'Test Visitor',
      company: 'Test Corp',
    },
    summary: {
      session_id: 'TEST-DRY-RUN',
      visitor_name: 'Test Visitor',
    },
    followUp: {
      priority: 'high',
      sdr_notes: 'This is a dry-run test of the notification system.',
    },
    dryRun: true,
  })
    .then(() => {
      console.log('[watcher] --test complete');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[watcher] --test failed: ${err.message}`);
      process.exit(1);
    });
}

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT, 10) || 8090;
const startTime = Date.now();
let sessionsProcessed = 0;

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
  health.setQueueDepth(sessions.length - dispatched.size);

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

      // If audio exists but no transcript, run transcriber first
      if (complete && complete.needsTranscription) {
        log(`  ${sessionId}: audio found, running transcriber...`);
        try {
          await runTranscriber(sessionId);
          log(`  ${sessionId}: transcription complete`);
        } catch (err) {
          health.recordFailed(sessionId);
          log(`  ${sessionId}: transcription FAILED — ${err.message}`);
          return; // Don't proceed to analysis without transcript
        }
      }

      log(`  ${sessionId}: COMPLETE — claiming and triggering analysis`);

      // Write claim marker before launching pipeline to prevent double-dispatch
      // on concurrent watcher instances or rapid restarts
      await writeMarker(BUCKET, sessionId, {
        claimed_at: new Date().toISOString(),
        claimed_by: process.env.HOSTNAME || 'watcher',
      });
      dispatched.add(sessionId);
      sessionsProcessed++;
      health.recordProcessed(sessionId);

      // Trigger pipeline (fire-and-forget — errors are logged, not fatal)
      triggerPipeline(sessionId, BUCKET)
        .then((result) => log(`  ${sessionId}: pipeline finished — ${result.status}`))
        .catch((err) => {
          health.recordFailed(sessionId);
          log(`  ${sessionId}: pipeline ERROR — ${err.message}`);
        });

    } catch (err) {
      log(`  ${sessionId}: ERROR checking session — ${err.message}`);
    }
  }));
}

function runTranscriber(sessionId) {
  return new Promise((resolve, reject) => {
    const script = path.resolve(__dirname, '..', 'audio', 'transcriber', 'index.js');
    const env = { ...process.env, S3_BUCKET: BUCKET };
    const proc = spawn(process.execPath, [script, sessionId], { env, stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Transcriber exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

function validateEnv() {
  const errors = [];

  if (!process.env.S3_BUCKET) {
    errors.push('S3_BUCKET is required — set it to the S3 bucket name for session data');
  }

  if (!process.env.AWS_REGION) {
    errors.push('AWS_REGION is required — set it to the AWS region (e.g. us-east-1)');
  }

  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE && !process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) {
    errors.push(
      'AWS credentials not found — set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, ' +
      'AWS_PROFILE, or run on an EC2 instance / ECS task with an IAM role'
    );
  }

  const useBedrock = (process.env.USE_BEDROCK || '').trim();
  if (['1', 'true', 'yes'].includes(useBedrock) && !process.env.ANALYSIS_MODEL) {
    errors.push(
      'ANALYSIS_MODEL is required when USE_BEDROCK=1 — set it to a Bedrock model ID ' +
      '(e.g. anthropic.claude-3-sonnet-20240229-v1:0)'
    );
  }

  if (errors.length > 0) {
    console.error('[watcher] Environment validation failed:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
}

async function run() {
  validateEnv();

  log(`Starting — bucket=${BUCKET} poll_interval=${POLL_INTERVAL_MS / 1000}s`);

  // Start health monitoring (port 8095, /tmp/watcher-health.json, log rotation)
  health.start();
  health.installSignalHandlers();
  health.onShutdown(() => {
    log('Finishing current work before exit...');
    clearInterval(pollTimer);
  });

  // Start legacy health check HTTP server (port 8090, backward compat)
  const healthServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        sessions_processed: sessionsProcessed,
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  healthServer.listen(HEALTH_PORT, () => {
    log(`Legacy health check listening on port ${HEALTH_PORT}`);
  });

  // Run immediately on start, then on interval
  await pollOnce();
  const pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

if (!process.argv.includes('--test')) {
  run().catch((err) => {
    console.error(`[watcher] FATAL: ${err.message}`);
    process.exit(1);
  });
}
