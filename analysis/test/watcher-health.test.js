'use strict';

const assert = require('assert');
const http = require('http');
const { createHealthServer } = require('../watcher');

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

const PORT = 18932; // high port to avoid conflicts

async function runTests() {
  const server = createHealthServer(Date.now());

  // Wait for server to be listening
  await new Promise((resolve) => server.on('listening', resolve));

  try {
    // Test 1: GET /health returns 200 with JSON
    {
      const res = await get(PORT, '/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'application/json');

      const body = JSON.parse(res.body);
      assert.strictEqual(body.status, 'ok');
      assert.strictEqual(typeof body.uptime, 'number');
      assert.strictEqual(typeof body.pendingSessions, 'number');
      assert.strictEqual(typeof body.pollIntervalMs, 'number');
      console.log('  [PASS] GET /health returns valid JSON status');
    }

    // Test 2: unknown path returns 404
    {
      const res = await get(PORT, '/unknown');
      assert.strictEqual(res.status, 404);
      console.log('  [PASS] unknown path returns 404');
    }

    // Test 3: uptime increases
    {
      const res = await get(PORT, '/health');
      const body = JSON.parse(res.body);
      assert(body.uptime >= 0, 'uptime should be non-negative');
      console.log('  [PASS] uptime is non-negative');
    }

    console.log('\nAll health endpoint tests passed.');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
