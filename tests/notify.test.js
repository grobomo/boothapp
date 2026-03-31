'use strict';

const http = require('http');
const path = require('path');
const assert = require('assert');
const {
  notifySessionComplete,
  sseHandler,
  sseClients,
  broadcastSSE,
  loadWebhookConfig,
  postWebhook,
  sendWebhooks,
} = require('../infra/notifications/notify');

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

const sampleSummary = {
  session_id: 'sess-001',
  visitor_name: 'Jane Doe',
  company: 'Acme Corp',
  topics: ['XDR', 'Endpoint Security'],
  engagement_score: 85,
  timestamp: '2026-03-31T10:00:00Z',
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] ${name}: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] ${name}: ${err.message}`);
  }
}

// -------------------------------------------------------------------------
// Config loading
// -------------------------------------------------------------------------

console.log('\n-- notify-config --');

test('loadWebhookConfig returns default when file missing', () => {
  const cfg = loadWebhookConfig('/nonexistent/path.json');
  assert.deepStrictEqual(cfg, { webhooks: [] });
});

test('loadWebhookConfig reads actual config file', () => {
  const cfg = loadWebhookConfig(path.join(__dirname, '..', 'infra', 'notifications', 'notify-config.json'));
  assert.ok(Array.isArray(cfg.webhooks));
  assert.ok(cfg.webhooks.length > 0);
  assert.strictEqual(cfg.webhooks[0].label, 'Slack Incoming Webhook');
});

// -------------------------------------------------------------------------
// SSE
// -------------------------------------------------------------------------

console.log('\n-- SSE --');

test('sseClients starts empty', () => {
  assert.strictEqual(sseClients.size, 0);
});

test('sseHandler adds client to set and removes on close', () => {
  const listeners = {};
  const fakeReq = {
    on: (evt, cb) => { listeners[evt] = cb; },
  };
  const written = [];
  const fakeRes = {
    writeHead: () => {},
    write: (data) => written.push(data),
  };

  sseHandler(fakeReq, fakeRes);
  assert.strictEqual(sseClients.size, 1);
  assert.ok(sseClients.has(fakeRes));
  assert.ok(written[0].includes('retry: 5000'));

  // Simulate close
  listeners.close();
  assert.strictEqual(sseClients.size, 0);
});

test('broadcastSSE sends to all connected clients', () => {
  const received = [];
  const fakeRes1 = { write: (d) => received.push(d) };
  const fakeRes2 = { write: (d) => received.push(d) };

  sseClients.add(fakeRes1);
  sseClients.add(fakeRes2);

  broadcastSSE('test-event', { foo: 'bar' });

  assert.strictEqual(received.length, 2);
  assert.ok(received[0].includes('event: test-event'));
  assert.ok(received[0].includes('"foo":"bar"'));

  // Cleanup
  sseClients.clear();
});

// -------------------------------------------------------------------------
// Webhook
// -------------------------------------------------------------------------

console.log('\n-- Webhook --');

async function runWebhookTests() {
  // Spin up a test HTTP server
  let lastBody = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      lastBody = JSON.parse(body);
      if (req.url === '/fail') {
        res.writeHead(500);
        res.end('error');
      } else {
        res.writeHead(200);
        res.end('ok');
      }
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  await testAsync('postWebhook delivers JSON to URL', async () => {
    const result = await postWebhook(`http://127.0.0.1:${port}/hook`, sampleSummary);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(lastBody.session_id, 'sess-001');
  });

  await testAsync('postWebhook reports failure on 5xx', async () => {
    const result = await postWebhook(`http://127.0.0.1:${port}/fail`, sampleSummary);
    assert.strictEqual(result.ok, false);
  });

  await testAsync('postWebhook handles invalid URL', async () => {
    const result = await postWebhook('not-a-url', sampleSummary);
    assert.strictEqual(result.ok, false);
    assert.ok(result.error);
  });

  await testAsync('sendWebhooks skips disabled webhooks', async () => {
    const logs = [];
    const config = {
      webhooks: [
        { label: 'Enabled', url: `http://127.0.0.1:${port}/hook`, enabled: true },
        { label: 'Disabled', url: `http://127.0.0.1:${port}/hook`, enabled: false },
      ],
    };
    const results = await sendWebhooks(sampleSummary, config, (msg) => logs.push(msg));
    assert.strictEqual(results.length, 1);
    assert.ok(logs.some((l) => l.includes('Enabled')));
    assert.ok(!logs.some((l) => l.includes('Disabled')));
  });

  await testAsync('sendWebhooks logs failures without throwing', async () => {
    const logs = [];
    const config = {
      webhooks: [
        { label: 'Good', url: `http://127.0.0.1:${port}/hook`, enabled: true },
        { label: 'Bad', url: `http://127.0.0.1:${port}/fail`, enabled: true },
      ],
    };
    const results = await sendWebhooks(sampleSummary, config, (msg) => logs.push(msg));
    assert.strictEqual(results.length, 2);
    assert.ok(logs.some((l) => l.includes('Bad') && l.includes('failed')));
    assert.ok(logs.some((l) => l.includes('Good') && l.includes('delivered')));
  });

  // -----------------------------------------------------------------------
  // Integration: notifySessionComplete
  // -----------------------------------------------------------------------

  console.log('\n-- notifySessionComplete --');

  await testAsync('notifySessionComplete sends SSE and webhooks', async () => {
    const sseData = [];
    const fakeRes = { write: (d) => sseData.push(d) };
    sseClients.add(fakeRes);

    const config = {
      webhooks: [
        { label: 'Test', url: `http://127.0.0.1:${port}/hook`, enabled: true },
      ],
    };
    const logs = [];
    const result = await notifySessionComplete(sampleSummary, {
      config,
      log: (msg) => logs.push(msg),
    });

    assert.strictEqual(result.sse, true);
    assert.strictEqual(result.webhooks.length, 1);
    assert.strictEqual(result.webhooks[0].ok, true);
    assert.ok(sseData[0].includes('session-complete'));
    assert.ok(sseData[0].includes('sess-001'));

    sseClients.clear();
  });

  server.close();
}

// -------------------------------------------------------------------------
// Run
// -------------------------------------------------------------------------

(async () => {
  await runWebhookTests();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
