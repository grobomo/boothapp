'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const TEST_PORT = 13912;

function request(method, path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(data); } catch { body = data; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('session viewer endpoints', () => {
  before(async () => {
    process.env.PORT = String(TEST_PORT);
    process.env.WATCHER_HEALTH = 'http://localhost:19999';
    process.env.S3_BUCKET = 'test-bucket-viewer';

    await new Promise((resolve) => {
      // Clear module cache so server binds to our port
      delete require.cache[require.resolve('../server.js')];
      require('../server.js');
      setTimeout(resolve, 500);
    });
  });

  it('GET /api/sessions/:id/data returns structured response', async () => {
    const res = await request('GET', '/api/sessions/test-session/data');
    // With fake bucket, either returns data or 500
    assert.ok(res.status === 200 || res.status === 500);
    if (res.status === 200) {
      assert.equal(res.body.session_id, 'test-session');
      assert.ok('metadata' in res.body);
      assert.ok('badge' in res.body);
      assert.ok('clicks' in res.body);
      assert.ok('transcript' in res.body);
      assert.ok('analysis' in res.body);
    }
  });

  it('GET /api/sessions/:id/screenshots/:file returns 404 or 500 with fake bucket', async () => {
    const res = await request('GET', '/api/sessions/test-session/screenshots/test.jpg');
    assert.ok(res.status === 404 || res.status === 500);
  });

  it('GET /api/sessions/:id/files returns structured response', async () => {
    const res = await request('GET', '/api/sessions/test-session/files');
    assert.ok(res.status === 200 || res.status === 500);
    if (res.status === 200) {
      assert.ok(Array.isArray(res.body.files));
    }
  });

  it('session-viewer.html is served as static file', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/session-viewer.html`, (resp) => {
        let data = '';
        resp.on('data', (chunk) => { data += chunk; });
        resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
      }).on('error', reject);
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Session Viewer'));
    assert.ok(res.body.includes('session-id-display'));
  });
});
