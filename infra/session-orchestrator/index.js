'use strict';
/**
 * Session Orchestrator — Lambda handler + local HTTP server.
 *
 * API:
 *   POST /sessions               — create session (Android app on badge scan)
 *   POST /sessions/:id/end       — end session (Android app or operator)
 *   GET  /sessions/:id           — get session state
 *   GET  /health                 — health check
 *
 * Deploy as Lambda (API Gateway HTTP API or Function URL) or run locally:
 *   node index.js
 */
const { createSession, endSession, getSession } = require('./orchestrator');

// ── Route table ────────────────────────────────────────────────────────────

const ROUTES = [
  { method: 'GET',  pattern: /^\/health$/,                   handler: handleHealth },
  { method: 'POST', pattern: /^\/sessions$/,                 handler: handleCreateSession },
  { method: 'POST', pattern: /^\/sessions\/([^/]+)\/end$/,   handler: handleEndSession },
  { method: 'GET',  pattern: /^\/sessions\/([^/]+)$/,        handler: handleGetSession },
];

async function handleHealth() {
  return respond(200, { status: 'ok', service: 'session-orchestrator' });
}

async function handleCreateSession(body) {
  const result = await createSession(body);
  return respond(201, result);
}

async function handleEndSession(body, matches) {
  const result = await endSession(matches[1], body);
  return respond(200, result);
}

async function handleGetSession(_body, matches) {
  const result = await getSession(matches[1]);
  return respond(200, result);
}

// ── Lambda handler ─────────────────────────────────────────────────────────

async function handler(event) {
  const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  const path   = (event.path || event.rawPath || '/').split('?')[0];
  let body     = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch (_) {}
  }

  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = path.match(route.pattern);
    if (!m) continue;
    try {
      return await route.handler(body, m);
    } catch (err) {
      return errorResponse(err);
    }
  }

  return respond(404, { error: 'Not found', path, method });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function errorResponse(err) {
  const status = err.statusCode || 500;
  console.error(`[orchestrator] ${err.message}`, err.stack);
  return respond(status, { error: err.message });
}

// ── Local HTTP server (dev / smoke-test) ───────────────────────────────────

if (require.main === module) {
  const http = require('http');
  const PORT = process.env.PORT || 3000;

  http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', async () => {
      const event = { httpMethod: req.method, path: req.url, body: raw || null };
      const result = await handler(event).catch(err => errorResponse(err));
      res.writeHead(result.statusCode, result.headers);
      res.end(result.body);
    });
  }).listen(PORT, () => console.log(`Session orchestrator listening on :${PORT}`));
}

module.exports = { handler };
