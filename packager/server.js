'use strict';
const http = require('http');
const { SessionManager } = require('./lib/session-manager');

const PORT = parseInt(process.env.PORT, 10) || 9222;
const HOST = '127.0.0.1';

const manager = new SessionManager();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
}

function json(res, status, data) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // CORS preflight
  if (method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // POST /screenshots
    if (method === 'POST' && url === '/screenshots') {
      if (!manager.session) return json(res, 409, { error: 'No active session' });

      const filename = req.headers['x-filename'] || `screenshot_${Date.now()}.jpg`;
      const body = await readBody(req);
      manager.addScreenshot(filename, body);
      return json(res, 200, { ok: true, count: manager.screenshotCount });
    }

    // POST /clicks
    if (method === 'POST' && url === '/clicks') {
      if (!manager.session) return json(res, 409, { error: 'No active session' });

      const body = await readBody(req);
      manager.addClicks(body.toString('utf-8'));
      return json(res, 200, { ok: true });
    }

    // POST /session/end
    if (method === 'POST' && url === '/session/end') {
      if (!manager.session) return json(res, 409, { error: 'No active session' });

      // Trigger packaging async — don't block the HTTP response
      manager._onSessionEnd().catch((err) => {
        console.error(`  [server] Packaging error: ${err.message}`);
      });
      return json(res, 200, { ok: true, packaging: true });
    }

    // GET /status
    if (method === 'GET' && url === '/status') {
      return json(res, 200, manager.getStatus());
    }

    // 404
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(`  [server] Error: ${err.message}`);
    json(res, 500, { error: err.message });
  }
});

// --- Startup ---
manager.startPolling();

server.listen(PORT, HOST, () => {
  console.log('============================================================');
  console.log('  CaseyApp Packager');
  console.log(`  Listening on http://${HOST}:${PORT}`);
  console.log(`  S3 Bucket: ${manager.bucket}`);
  console.log('============================================================');
  console.log('');
  console.log('  Waiting for session ...');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n  [server] Shutting down ...');
  manager.stopPolling();
  if (manager.audio.recording) {
    await manager.audio.stop();
  }
  server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  manager.stopPolling();
  if (manager.audio.recording) await manager.audio.stop();
  server.close();
  process.exit(0);
});
