'use strict';

const fs = require('fs');
const path = require('path');
const { BoothAppWS } = require('../infra/ws-client');

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 5000;
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, '..', 'sessions');
const WS_URL = process.env.WS_URL || 'ws://localhost:3001';

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`${ts} [watcher] ${msg}`);
}

/**
 * Track known session states to detect transitions.
 * States: unknown -> started -> ended (has output/) -> analysis.completed (has result.json)
 */
function createWatcher(options = {}) {
  const sessionsDir = options.sessionsDir || SESSIONS_DIR;
  const wsUrl = options.wsUrl || WS_URL;
  const pollInterval = options.pollIntervalMs || POLL_INTERVAL_MS;

  // Connect to WS server for broadcasting events
  const ws = options.wsClient || new BoothAppWS(wsUrl);
  const knownSessions = new Map(); // sessionId -> { state }

  function getSessionState(sessionId) {
    const sessionDir = path.join(sessionsDir, sessionId);
    const readyFile = path.join(sessionDir, 'ready');
    const outputDir = path.join(sessionDir, 'output');
    const resultFile = path.join(outputDir, 'result.json');
    const errorFile = path.join(outputDir, 'error.json');

    if (fs.existsSync(resultFile) || fs.existsSync(errorFile)) {
      return 'completed';
    }
    if (fs.existsSync(readyFile)) {
      return 'started';
    }
    return 'unknown';
  }

  function scan() {
    if (!fs.existsSync(sessionsDir)) return;

    const sessionIds = fs.readdirSync(sessionsDir).filter((name) => {
      return fs.statSync(path.join(sessionsDir, name)).isDirectory();
    });

    for (const sessionId of sessionIds) {
      const currentState = getSessionState(sessionId);
      const known = knownSessions.get(sessionId);

      if (!known) {
        // First time seeing this session
        knownSessions.set(sessionId, { state: currentState });
        if (currentState === 'started') {
          log(`session=${sessionId} detected as started`);
          ws.send('session.started', { sessionId });
        } else if (currentState === 'completed') {
          log(`session=${sessionId} detected as completed`);
          ws.send('analysis.completed', { sessionId });
        }
        continue;
      }

      // State transition detection
      if (known.state !== currentState) {
        log(`session=${sessionId} ${known.state} -> ${currentState}`);

        if (currentState === 'started' && known.state === 'unknown') {
          ws.send('session.started', { sessionId });
        } else if (currentState === 'completed') {
          ws.send('analysis.completed', { sessionId });
        }

        known.state = currentState;
      }
    }
  }

  const interval = setInterval(scan, pollInterval);

  // Run immediately
  scan();

  return {
    stop() {
      clearInterval(interval);
      ws.close();
      log('watcher stopped');
    },
    scan, // exposed for testing
    knownSessions,
  };
}

// Run directly
if (require.main === module) {
  log(`started (poll=${POLL_INTERVAL_MS}ms, sessions=${SESSIONS_DIR})`);
  createWatcher();
}

module.exports = { createWatcher };
