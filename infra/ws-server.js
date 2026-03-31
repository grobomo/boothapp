'use strict';

const { WebSocketServer } = require('ws');

const WS_PORT = parseInt(process.env.WS_PORT, 10) || 3001;
const HEARTBEAT_INTERVAL_MS = 30000;

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`${ts} [ws-server] ${msg}`);
}

/**
 * Create and start the WebSocket server.
 * Returns { wss, broadcast, close } for programmatic use.
 */
function createServer(options = {}) {
  const port = options.port || WS_PORT;
  const wss = new WebSocketServer({ port });

  log(`listening on :${port}`);

  // --- Heartbeat ---
  // Track liveness per client. If a client misses a pong, terminate it.

  wss.on('connection', (ws, req) => {
    const remote = req.socket.remoteAddress;
    log(`client connected from ${remote} (total=${wss.clients.size})`);

    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      log(`client disconnected (total=${wss.clients.size})`);
    });

    ws.on('error', (err) => {
      log(`client error: ${err.message}`);
    });

    // Send a welcome message so clients know they're connected
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
  });

  // Ping all clients every HEARTBEAT_INTERVAL_MS; terminate unresponsive ones
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        log('terminating unresponsive client');
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, options.heartbeatInterval || HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  /**
   * Broadcast an event to all connected clients.
   * @param {string} eventType - e.g. 'session.started', 'session.ended', 'analysis.completed'
   * @param {object} data - event payload
   */
  function broadcast(eventType, data = {}) {
    const message = JSON.stringify({
      type: eventType,
      data,
      timestamp: new Date().toISOString(),
    });

    let sent = 0;
    wss.clients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
        sent++;
      }
    });

    log(`broadcast ${eventType} to ${sent} client(s)`);
  }

  /**
   * Gracefully shut down the server.
   */
  function close() {
    clearInterval(heartbeat);
    return new Promise((resolve) => {
      wss.close(() => {
        log('server closed');
        resolve();
      });
    });
  }

  // Accept inbound events via WebSocket messages from the watcher
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type && msg.type.startsWith('session.') || msg.type === 'analysis.completed') {
          broadcast(msg.type, msg.data || {});
        }
      } catch {
        // Ignore non-JSON or malformed messages
      }
    });
  });

  return { wss, broadcast, close };
}

// Run directly
if (require.main === module) {
  createServer();
}

module.exports = { createServer };
