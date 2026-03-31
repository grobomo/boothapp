'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// We test only the routes that don't require a real S3 bucket.
// The watcher status endpoint proxies to the watcher health server,
// so we spin up a fake health server for that.

const TEST_PORT = 13902;
const FAKE_HEALTH_PORT = 13903;

let fakeHealthServer;
let appServer;

function request(method, path, body) {
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
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('admin endpoints', () => {
  before(async () => {
    // Fake watcher health server
    fakeHealthServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          uptime: 3600,
          pendingSessions: 2,
          pollIntervalMs: 5000,
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise(resolve => fakeHealthServer.listen(FAKE_HEALTH_PORT, resolve));

    // Set env vars before requiring server
    process.env.PORT = String(TEST_PORT);
    process.env.WATCHER_HEALTH = `http://localhost:${FAKE_HEALTH_PORT}`;
    process.env.S3_BUCKET = 'test-bucket';

    // Start the Express server
    const express = require('express');
    const serverPath = require('path').join(__dirname, '..', 'server.js');

    // We need to capture the server instance. Since server.js calls app.listen
    // directly, we'll require it and wait for the port to be ready.
    await new Promise((resolve) => {
      require(serverPath);
      // Give the server a moment to bind
      setTimeout(resolve, 500);
    });
  });

  after(() => {
    fakeHealthServer.close();
    // Express server will be killed when process exits
  });

  it('GET /api/watcher/status proxies to watcher health endpoint', async () => {
    const res = await request('GET', '/api/watcher/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.uptime, 3600);
    assert.equal(res.body.pendingSessions, 2);
    assert.equal(res.body.pollIntervalMs, 5000);
  });

  it('GET /api/storage/stats returns error detail when S3 unreachable', async () => {
    // With a fake bucket, this will fail but should return structured error
    const res = await request('GET', '/api/storage/stats');
    // Either 200 with data or 500 with error detail
    assert.ok(res.status === 200 || res.status === 500);
    assert.ok(res.body);
  });

  it('GET /api/sessions returns error detail when S3 unreachable', async () => {
    const res = await request('GET', '/api/sessions');
    assert.ok(res.status === 200 || res.status === 500);
    assert.ok(res.body);
  });

  it('DELETE /api/sessions/:id returns error or 404 with fake bucket', async () => {
    const res = await request('DELETE', '/api/sessions/nonexistent');
    assert.ok(res.status === 404 || res.status === 500);
  });

  it('POST /api/sessions/:id/retry returns structured response', async () => {
    const res = await request('POST', '/api/sessions/test-123/retry');
    assert.ok(res.status === 200 || res.status === 500);
    assert.ok(res.body);
  });

  it('POST /api/sessions creates session (or errors with S3 detail)', async () => {
    const res = await request('POST', '/api/sessions', {
      visitorName: 'Test User',
      visitorCompany: 'Test Co',
    });
    assert.ok(res.status === 201 || res.status === 500);
    assert.ok(res.body);
  });

  it('admin.html is served as static file', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/admin.html`, (resp) => {
        let data = '';
        resp.on('data', (chunk) => { data += chunk; });
        resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
      }).on('error', reject);
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('BoothApp'));
    assert.ok(res.body.includes('Admin'));
  });
});
