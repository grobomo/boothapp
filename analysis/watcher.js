'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { classifyError } = require('./lib/errors');
const { writeErrorJson } = require('./lib/error-writer');
const { runPipelineWithTimeout } = require('./pipeline-run');
const { retry } = require('./lib/retry');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 5000;
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, '..', 'sessions');
const MAX_SESSION_ATTEMPTS = 3;
const STATS_PORT = parseInt(process.env.STATS_PORT, 10) || 3001;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const metrics = {
  sessionsProcessed: 0,
  sessionsErrored: 0,
  totalProcessingMs: 0,
  startedAt: null,
};

function getStats() {
  const avg = metrics.sessionsProcessed > 0
    ? Math.round(metrics.totalProcessingMs / metrics.sessionsProcessed)
    : 0;
  return {
    sessions_processed: metrics.sessionsProcessed,
    sessions_errored: metrics.sessionsErrored,
    avg_processing_time_ms: avg,
    uptime_s: metrics.startedAt
      ? Math.round((Date.now() - metrics.startedAt) / 1000)
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`${ts} [watcher] ${msg}`);
}

/**
 * Track how many times a session has been attempted.
 * Stored in sessions/<id>/output/.attempts (simple integer file).
 */
function getAttemptCount(sessionId) {
  const file = path.join(SESSIONS_DIR, sessionId, 'output', '.attempts');
  try {
    return parseInt(fs.readFileSync(file, 'utf8').trim(), 10) || 0;
  } catch (_) {
    return 0;
  }
}

function setAttemptCount(sessionId, count) {
  const dir = path.join(SESSIONS_DIR, sessionId, 'output');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.attempts'), String(count));
}

/**
 * Build AWS SDK clients lazily so the module can be required without the
 * SDK installed (for testing / linting).
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
 * A session is "pending" when it has a trigger file but no result or error output.
 */
function getPendingSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];

  return fs.readdirSync(SESSIONS_DIR).filter((id) => {
    const trigger = path.join(SESSIONS_DIR, id, 'ready');
    const result = path.join(SESSIONS_DIR, id, 'output', 'result.json');
    const errorFile = path.join(SESSIONS_DIR, id, 'output', 'error.json');
    return fs.existsSync(trigger) && !fs.existsSync(result) && !fs.existsSync(errorFile);
  });
}

// ---------------------------------------------------------------------------
// Session processing with dead-letter handling
// ---------------------------------------------------------------------------

/**
 * Process a single session. Uses retry for S3 operations within the pipeline,
 * plus dead-letter handling: after MAX_SESSION_ATTEMPTS total failures across
 * poll cycles, the session is moved to error state with full failure details.
 */
async function processSession(sessionId, clients, config) {
  const attemptNumber = getAttemptCount(sessionId) + 1;
  log(`processing session=${sessionId} attempt=${attemptNumber}/${MAX_SESSION_ATTEMPTS}`);

  const startTime = Date.now();

  try {
    const result = await runPipelineWithTimeout({
      sessionId,
      sessionsDir: SESSIONS_DIR,
      s3: clients.s3,
      bedrock: clients.bedrock,
      config,
      log,
    });

    // Write successful result
    const outputDir = path.join(SESSIONS_DIR, sessionId, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'result.json'),
      JSON.stringify(result, null, 2) + '\n',
    );

    const elapsed = Date.now() - startTime;
    metrics.sessionsProcessed++;
    metrics.totalProcessingMs += elapsed;
    log(`session=${sessionId} completed in ${elapsed}ms`);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const classified = classifyError(err);

    log(`session=${sessionId} attempt=${attemptNumber} FAILED type=${classified.type}`);

    if (attemptNumber >= MAX_SESSION_ATTEMPTS) {
      // Dead letter: write error.json so the session won't be retried
      log(`session=${sessionId} exhausted ${MAX_SESSION_ATTEMPTS} attempts -- dead-lettered`);
      writeErrorJson(SESSIONS_DIR, sessionId, 'pipeline', err, attemptNumber);
      metrics.sessionsErrored++;
      metrics.totalProcessingMs += elapsed;
    } else {
      // Record attempt count; session will be picked up on next poll cycle
      setAttemptCount(sessionId, attemptNumber);
    }
  }
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

async function poll(clients, config) {
  const pending = getPendingSessions();
  if (pending.length > 0) {
    log(`found ${pending.length} pending session(s)`);
  }
  for (const sessionId of pending) {
    await processSession(sessionId, clients, config);
  }
}

// ---------------------------------------------------------------------------
// HTTP metrics server
// ---------------------------------------------------------------------------

function startStatsServer(port) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/watcher-stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getStats(), null, 2) + '\n');
    } else {
      res.writeHead(404);
      res.end('Not Found\n');
    }
  });
  server.listen(port, () => {
    log(`stats server listening on http://0.0.0.0:${port}/api/watcher-stats`);
  });
  return server;
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let _shuttingDown = false;

function isShuttingDown() {
  return _shuttingDown;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

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
    clients = configOverrides._clients || buildClients();
  } catch (err) {
    log(`FATAL: cannot initialize AWS clients: ${err.message}`);
    process.exit(1);
  }

  metrics.startedAt = Date.now();
  _shuttingDown = false;

  log(`started (poll=${POLL_INTERVAL_MS}ms, bucket=${config.bucket})`);

  // Start metrics HTTP server
  const statsServer = startStatsServer(
    configOverrides.statsPort || STATS_PORT,
  );

  // Poll loop
  const interval = setInterval(() => {
    if (_shuttingDown) return;
    poll(clients, config).catch((err) => {
      log(`unexpected poll error: ${err.message}`);
    });
  }, POLL_INTERVAL_MS);

  // Immediate first poll
  poll(clients, config).catch((err) => {
    log(`unexpected poll error: ${err.message}`);
  });

  // Graceful shutdown on SIGTERM
  const shutdown = () => {
    if (_shuttingDown) return;
    _shuttingDown = true;
    log('SIGTERM received -- shutting down gracefully');
    clearInterval(interval);
    statsServer.close(() => {
      log('stats server closed');
    });
    // Allow current processSession to finish (it's awaited in poll)
    // The interval is cleared so no new polls start.
    log('shutdown complete');
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return {
    stop: () => {
      shutdown();
      process.removeListener('SIGTERM', shutdown);
      process.removeListener('SIGINT', shutdown);
    },
    getStats,
    statsServer,
  };
}

// Run directly
if (require.main === module) {
  start();
}

module.exports = {
  start,
  processSession,
  getPendingSessions,
  getStats,
  isShuttingDown,
  MAX_SESSION_ATTEMPTS,
};
