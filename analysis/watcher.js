'use strict';

const fs = require('fs');
const path = require('path');
const { classifyError } = require('./lib/errors');
const { writeErrorJson } = require('./lib/error-writer');
const { runPipelineWithTimeout } = require('./pipeline-run');
const { retry } = require('./lib/retry');

// ---------------------------------------------------------------------------
// Watcher — monitors sessions directory for new recordings and kicks off
// the analysis pipeline.  Errors are classified, logged, and written to
// sessions/<id>/output/error.json so the dashboard can display them.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 5000;
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, '..', 'sessions');

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`${ts} [watcher] ${msg}`);
}

/**
 * Build AWS SDK clients lazily so the module can be required without the SDK
 * installed (for testing / linting).
 */
function buildClients() {
  const { S3Client } = require('@aws-sdk/client-s3');
  const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');

  return {
    s3: new S3Client({ region: process.env.AWS_REGION || 'us-east-1' }),
    bedrock: new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' }),
  };
}

/**
 * Check whether a session needs processing.
 * A session is "pending" when it has a trigger file but no output yet.
 */
function getPendingSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];

  return fs.readdirSync(SESSIONS_DIR).filter((id) => {
    const trigger = path.join(SESSIONS_DIR, id, 'ready');
    const output = path.join(SESSIONS_DIR, id, 'output', 'result.json');
    const errorFile = path.join(SESSIONS_DIR, id, 'output', 'error.json');
    return fs.existsSync(trigger) && !fs.existsSync(output) && !fs.existsSync(errorFile);
  });
}

const MAX_SESSION_RETRIES = 2;

/**
 * Upload error.json to S3 so the dashboard can display it even if local
 * disk state is lost.
 */
async function writeErrorToS3(s3Client, bucket, sessionId, stage, err) {
  try {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const classified = classifyError(err);
    const payload = {
      error: true,
      timestamp: new Date().toISOString(),
      sessionId,
      stage,
      type: classified.type,
      retryable: classified.retryable,
      message: classified.message,
      code: classified.code,
      detail: classified.detail,
    };
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `sessions/${sessionId}/output/error.json`,
      Body: JSON.stringify(payload, null, 2),
      ContentType: 'application/json',
    }));
    log(`wrote error.json to s3://${bucket}/sessions/${sessionId}/output/error.json`);
  } catch (s3Err) {
    log(`WARNING: failed to write error.json to S3: ${s3Err.message}`);
  }
}

/**
 * Process a single session with up to MAX_SESSION_RETRIES retries.
 * On final failure, writes error.json to both local disk and S3.
 */
async function processSession(sessionId, clients, config) {
  log(`processing session=${sessionId}`);

  const runOnce = async () => {
    const result = await runPipelineWithTimeout({
      sessionId,
      sessionsDir: SESSIONS_DIR,
      s3: clients.s3,
      bedrock: clients.bedrock,
      config,
      log,
    });
    return result;
  };

  try {
    const result = await retry(runOnce, {
      maxRetries: MAX_SESSION_RETRIES,
      baseDelayMs: config.baseDelayMs || 1000,
      maxDelayMs: config.maxDelayMs || 30000,
      shouldRetry: (err) => classifyError(err).retryable,
      onRetry: (err, attempt, delayMs) => {
        const classified = classifyError(err);
        log(`session=${sessionId} retry ${attempt}/${MAX_SESSION_RETRIES} type=${classified.type} delay=${delayMs}ms`);
      },
    });

    // Write successful result
    const outputDir = path.join(SESSIONS_DIR, sessionId, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'result.json'),
      JSON.stringify(result, null, 2) + '\n',
    );

    log(`session=${sessionId} completed successfully`);
  } catch (err) {
    const classified = classifyError(err);

    log(`session=${sessionId} FAILED type=${classified.type} retryable=${classified.retryable}`);

    // Write error.json locally
    writeErrorJson(SESSIONS_DIR, sessionId, 'pipeline', err);

    // Write error.json to S3
    if (clients.s3) {
      await writeErrorToS3(clients.s3, config.bucket, sessionId, 'pipeline', err);
    }

    if (classified.type === 's3_access_denied') {
      log(`  -> S3 access denied. Check IAM role/policy for bucket "${config.bucket}".`);
    } else if (classified.type === 'missing_file') {
      log(`  -> Recording file not found. Was it uploaded? Detail: ${classified.detail}`);
    } else if (classified.type === 'throttling') {
      log(`  -> Service throttled. Retried ${MAX_SESSION_RETRIES} times before giving up.`);
    } else if (classified.type === 'bedrock_validation') {
      log(`  -> Bedrock rejected the request. Check model ID and payload format.`);
    } else {
      log(`  -> ${classified.message}`);
    }
  }
}

/**
 * Main poll loop.
 */
async function poll(clients, config) {
  const pending = getPendingSessions();
  if (pending.length > 0) {
    log(`found ${pending.length} pending session(s)`);
  }

  for (const sessionId of pending) {
    await processSession(sessionId, clients, config);
  }
}

/**
 * Start the watcher.  Exported so tests can call start() and stop().
 */
function start(configOverrides = {}) {
  const config = {
    bucket: process.env.S3_BUCKET || 'boothapp-recordings',
    modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0',
    maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
    baseDelayMs: parseInt(process.env.BASE_DELAY_MS, 10) || 1000,
    maxDelayMs: parseInt(process.env.MAX_DELAY_MS, 10) || 30000,
    ...configOverrides,
  };

  let clients;
  try {
    clients = buildClients();
  } catch (err) {
    log(`FATAL: cannot initialize AWS clients: ${err.message}`);
    process.exit(1);
  }

  log(`started (poll=${POLL_INTERVAL_MS}ms, bucket=${config.bucket}, model=${config.modelId})`);

  const interval = setInterval(() => {
    poll(clients, config).catch((err) => {
      log(`unexpected poll error: ${err.message}`);
    });
  }, POLL_INTERVAL_MS);

  // Run immediately on start
  poll(clients, config).catch((err) => {
    log(`unexpected poll error: ${err.message}`);
  });

  return {
    stop: () => clearInterval(interval),
  };
}

// Run directly
if (require.main === module) {
  start();
}

module.exports = { start, processSession, getPendingSessions };
