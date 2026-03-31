'use strict';
/**
 * Session Orchestrator — Lambda handler + local HTTP server.
 *
 * API:
 *   GET  /sessions               — list all sessions with metadata + analysis status
 *   POST /sessions               — create session (Android app on badge scan)
 *   POST /sessions/:id/end       — end session (Android app or operator)
 *   GET  /sessions/:id           — get session metadata + command flags
 *   GET  /sessions/:id/state     — get session lifecycle state + history
 *   POST /sessions/:id/state     — transition session to a new state
 *   GET  /health                 — health check
 *
 * Deploy as Lambda (API Gateway HTTP API or Function URL) or run locally:
 *   node index.js
 */
const { createSession, endSession, getSession, listSessions, transitionState, getSessionState } = require('./orchestrator');

// ── Route table ────────────────────────────────────────────────────────────

const ROUTES = [
  { method: 'GET',  pattern: /^\/health$/,                   handler: handleHealth },
  { method: 'GET',  pattern: /^\/sessions$/,                 handler: handleListSessions },
  { method: 'POST', pattern: /^\/sessions$/,                 handler: handleCreateSession },
  { method: 'POST', pattern: /^\/sessions\/([^/]+)\/end$/,   handler: handleEndSession },
  { method: 'GET',  pattern: /^\/sessions\/([^/]+)\/state$/, handler: handleGetState },
  { method: 'POST', pattern: /^\/sessions\/([^/]+)\/state$/, handler: handleTransitionState },
  { method: 'GET',  pattern: /^\/sessions\/([^/]+)$/,        handler: handleGetSession },
];

async function handleHealth(_body, _matches, origin) {
  return respond(200, { status: 'ok', service: 'session-orchestrator' }, origin);
}

async function handleListSessions(_body, _matches, origin) {
  const result = await listSessions();
  return respond(200, result, origin);
}

async function handleCreateSession(body, _matches, origin) {
  const result = await createSession(body);
  return respond(201, result, origin);
}

async function handleEndSession(body, matches, origin) {
  const result = await endSession(matches[1], body);
  return respond(200, result, origin);
}

async function handleGetSession(_body, matches, origin) {
  const result = await getSession(matches[1]);
  return respond(200, result, origin);
}

async function handleGetState(_body, matches, origin) {
  const result = await getSessionState(matches[1]);
  return respond(200, result, origin);
}

async function handleTransitionState(body, matches, origin) {
  const { state, context } = body;
  if (!state) {
    return respond(400, { error: 'Missing required field: state' }, origin);
  }
  const result = await transitionState(matches[1], state, context || {});
  return respond(200, result, origin);
}

// ── Lambda handler ─────────────────────────────────────────────────────────

async function handler(event) {
  const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  const path   = (event.path || event.rawPath || '/').split('?')[0];
  const origin = event.headers?.origin || event.headers?.Origin || '';
  let body     = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch (_) {}
  }

  // CORS preflight
  if (method === 'OPTIONS') {
    return respond(204, '', origin);
  }

  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = path.match(route.pattern);
    if (!m) continue;
    try {
      return await route.handler(body, m, origin);
    } catch (err) {
      return errorResponse(err, origin);
    }
  }

  return respond(404, { error: 'Not found', path, method }, origin);
}

const ALLOWED_ORIGINS = [
  'https://boothapp.trendcyberrange.com',
  'https://hackathon.trendcyberrange.com',
  'http://localhost:3000',
];

function respond(statusCode, body, origin) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
}

function errorResponse(err, origin) {
  const status = err.statusCode || 500;
  console.error(`[orchestrator] ${err.message}`, err.stack);
  return respond(status, { error: err.message }, origin);
}

// ── Local HTTP server (dev / smoke-test) ───────────────────────────────────

if (require.main === module) {
  const http = require('http');
  const PORT = process.env.PORT || 3000;

  http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', async () => {
      const event = { httpMethod: req.method, path: req.url, body: raw || null, headers: req.headers };
      const result = await handler(event).catch(err => errorResponse(err));
      res.writeHead(result.statusCode, result.headers);
      res.end(result.body);
    });
  }).listen(PORT, '0.0.0.0', () => console.log(`Session orchestrator listening on :${PORT}`));
}

module.exports = { handler };
