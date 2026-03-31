'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ---------------------------------------------------------------------------
// SSE client registry -- presenter dashboard connects here
// ---------------------------------------------------------------------------

const sseClients = new Set();

/**
 * Express-compatible middleware handler for SSE connections.
 * Mount on GET /api/notifications/stream
 */
function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 5000\n\n');

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

/**
 * Push an SSE event to every connected browser.
 */
function broadcastSSE(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// ---------------------------------------------------------------------------
// Webhook delivery
// ---------------------------------------------------------------------------

/**
 * Load webhook config from notify-config.json.
 * @param {string} [configPath] - override path for testing
 */
function loadWebhookConfig(configPath) {
  const p = configPath || path.join(__dirname, 'notify-config.json');
  if (!fs.existsSync(p)) return { webhooks: [] };
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/**
 * POST a JSON payload to a single URL.  Returns a promise that resolves to
 * { ok: true } or { ok: false, error: string }.
 */
function postWebhook(url, payload) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const body = JSON.stringify(payload);
      const transport = parsed.protocol === 'https:' ? https : http;

      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 10000,
        },
        (res) => {
          // Drain response body
          res.resume();
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 });
        },
      );

      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'timeout' });
      });
      req.write(body);
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

/**
 * Send webhooks to all enabled URLs in config.  Failures are logged but
 * do not block other webhooks or the caller.
 */
async function sendWebhooks(summary, config, log) {
  const logger = log || console.log;
  const webhooks = (config || loadWebhookConfig()).webhooks || [];
  const enabled = webhooks.filter((w) => w.enabled !== false);

  const results = await Promise.allSettled(
    enabled.map(async (wh) => {
      const result = await postWebhook(wh.url, summary);
      if (!result.ok) {
        logger(`[notify] webhook "${wh.label}" failed: ${result.error || 'non-2xx status'}`);
      } else {
        logger(`[notify] webhook "${wh.label}" delivered`);
      }
      return { label: wh.label, ...result };
    }),
  );

  return results.map((r) => r.value || { ok: false, error: r.reason?.message });
}

// ---------------------------------------------------------------------------
// Main entry point -- call after summary.json is written to S3
// ---------------------------------------------------------------------------

/**
 * Notify all channels that a session analysis is complete.
 *
 * @param {Object} sessionSummary - the summary payload (session_id, visitor_name, etc.)
 * @param {Object} [opts]
 * @param {Object} [opts.config]     - webhook config override (for testing)
 * @param {Function} [opts.log]      - logger function
 */
async function notifySessionComplete(sessionSummary, opts = {}) {
  const logger = opts.log || console.log;

  // 1. Browser push via SSE
  broadcastSSE('session-complete', sessionSummary);
  logger(`[notify] SSE broadcast for session=${sessionSummary.session_id || 'unknown'}`);

  // 2. Webhook POST
  const webhookResults = await sendWebhooks(sessionSummary, opts.config, logger);

  return { sse: true, webhooks: webhookResults };
}

module.exports = {
  notifySessionComplete,
  sseHandler,
  broadcastSSE,
  sseClients,
  loadWebhookConfig,
  postWebhook,
  sendWebhooks,
};
