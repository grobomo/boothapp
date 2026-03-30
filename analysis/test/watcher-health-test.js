#!/usr/bin/env node
// Unit tests for analysis/watcher-health.js module
'use strict';

const http = require('http');
const fs = require('fs');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function runTests() {
  const health = require('../watcher-health');

  // Start health server
  health.start();

  // Wait for server to bind
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    console.log('\nTest 1: GET /health returns 200 with all required fields');
    {
      const res = await httpGet(8095, '/health');
      assert(res.statusCode === 200, 'status code is 200');
      const body = JSON.parse(res.body);
      assert(body.status === 'ok', 'status is "ok"');
      assert(typeof body.uptime_seconds === 'number', 'uptime_seconds is number');
      assert(body.sessions_processed === 0, 'sessions_processed starts at 0');
      assert(body.sessions_failed === 0, 'sessions_failed starts at 0');
      assert(body.last_session_id === null, 'last_session_id starts null');
      assert(body.last_processed_at === null, 'last_processed_at starts null');
      assert(body.queue_depth === 0, 'queue_depth starts at 0');
    }

    console.log('\nTest 2: recordProcessed updates stats');
    {
      health.recordProcessed('sess-001');
      health.recordProcessed('sess-002');
      const res = await httpGet(8095, '/health');
      const body = JSON.parse(res.body);
      assert(body.sessions_processed === 2, `sessions_processed is 2 (got ${body.sessions_processed})`);
      assert(body.last_session_id === 'sess-002', `last_session_id is sess-002 (got ${body.last_session_id})`);
      assert(body.last_processed_at !== null, 'last_processed_at is set');
    }

    console.log('\nTest 3: recordFailed updates stats');
    {
      health.recordFailed('sess-003');
      const res = await httpGet(8095, '/health');
      const body = JSON.parse(res.body);
      assert(body.sessions_failed === 1, `sessions_failed is 1 (got ${body.sessions_failed})`);
      assert(body.last_session_id === 'sess-003', `last_session_id updated to sess-003`);
    }

    console.log('\nTest 4: setQueueDepth updates stats');
    {
      health.setQueueDepth(12);
      const res = await httpGet(8095, '/health');
      const body = JSON.parse(res.body);
      assert(body.queue_depth === 12, `queue_depth is 12 (got ${body.queue_depth})`);
    }

    console.log('\nTest 5: Unknown path returns 404');
    {
      const res = await httpGet(8095, '/unknown');
      assert(res.statusCode === 404, `404 for unknown path (got ${res.statusCode})`);
    }

    console.log('\nTest 6: Health file written to /tmp');
    {
      // The initial flush happens on start()
      const exists = fs.existsSync('/tmp/watcher-health.json');
      assert(exists, 'health.json exists in /tmp');
      if (exists) {
        const data = JSON.parse(fs.readFileSync('/tmp/watcher-health.json', 'utf8'));
        assert(data.status === 'ok', 'health.json has status ok');
      }
    }

    console.log('\nTest 7: getHealthPayload returns consistent snapshot');
    {
      const payload = health.getHealthPayload();
      assert(payload.sessions_processed === 2, 'payload matches processed count');
      assert(payload.sessions_failed === 1, 'payload matches failed count');
      assert(payload.queue_depth === 12, 'payload matches queue depth');
    }

  } finally {
    // Force exit since server is listening
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
