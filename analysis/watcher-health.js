'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const HEALTH_PORT = 8095;
const HEALTH_FILE = '/tmp/watcher-health.json';
const LOG_FILE = path.join(__dirname, 'watcher.log');
const LOG_MAX_LINES = 1000;
const FLUSH_INTERVAL_MS = 30 * 1000;

// --- Stats tracking ---

const stats = {
  startTime: Date.now(),
  sessionsProcessed: 0,
  sessionsFailed: 0,
  lastSessionId: null,
  lastProcessedAt: null,
  queueDepth: 0,
};

function recordProcessed(sessionId) {
  stats.sessionsProcessed++;
  stats.lastSessionId = sessionId;
  stats.lastProcessedAt = new Date().toISOString();
}

function recordFailed(sessionId) {
  stats.sessionsFailed++;
  stats.lastSessionId = sessionId;
  stats.lastProcessedAt = new Date().toISOString();
}

function setQueueDepth(depth) {
  stats.queueDepth = depth;
}

function getHealthPayload() {
  return {
    status: 'ok',
    uptime_seconds: Math.floor((Date.now() - stats.startTime) / 1000),
    sessions_processed: stats.sessionsProcessed,
    sessions_failed: stats.sessionsFailed,
    last_session_id: stats.lastSessionId,
    last_processed_at: stats.lastProcessedAt,
    queue_depth: stats.queueDepth,
  };
}

// --- Health file writer (every 30s) ---

let flushTimer = null;

function flushHealthFile() {
  try {
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(getHealthPayload(), null, 2) + '\n');
  } catch (err) {
    console.error(`[watcher-health] Failed to write ${HEALTH_FILE}: ${err.message}`);
  }
}

// --- Log rotation ---

function rotateLog() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.split('\n');
    if (lines.length > LOG_MAX_LINES) {
      const trimmed = lines.slice(lines.length - LOG_MAX_LINES).join('\n');
      fs.writeFileSync(LOG_FILE, trimmed);
    }
  } catch (err) {
    console.error(`[watcher-health] Log rotation failed: ${err.message}`);
  }
}

// --- HTTP health server ---

let server = null;

function start() {
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const payload = getHealthPayload();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(HEALTH_PORT, () => {
    console.log(`[watcher-health] Health endpoint listening on port ${HEALTH_PORT}`);
  });

  // Flush health.json every 30s
  flushHealthFile();
  flushTimer = setInterval(() => {
    flushHealthFile();
    rotateLog();
  }, FLUSH_INTERVAL_MS);

  return server;
}

// --- Graceful shutdown ---

let shutdownCallback = null;
let shuttingDown = false;

function onShutdown(cb) {
  shutdownCallback = cb;
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[watcher-health] ${signal} received — shutting down gracefully`);

  // Stop accepting new connections
  if (server) {
    server.close();
  }

  // Clear timers
  if (flushTimer) {
    clearInterval(flushTimer);
  }

  // Final flush
  flushHealthFile();

  // Let caller finish current work
  if (shutdownCallback) {
    Promise.resolve(shutdownCallback())
      .then(() => {
        console.log('[watcher-health] Graceful shutdown complete');
        process.exit(0);
      })
      .catch((err) => {
        console.error(`[watcher-health] Shutdown error: ${err.message}`);
        process.exit(1);
      });
  } else {
    console.log('[watcher-health] Graceful shutdown complete');
    process.exit(0);
  }
}

function installSignalHandlers() {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = {
  start,
  recordProcessed,
  recordFailed,
  setQueueDepth,
  getHealthPayload,
  onShutdown,
  installSignalHandlers,
};
