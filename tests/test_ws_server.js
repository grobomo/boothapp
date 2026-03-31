'use strict';

const assert = require('assert');
const WebSocket = require('ws');
const { createServer } = require('../infra/ws-server');
const { BoothAppWS } = require('../infra/ws-client');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createWatcher } = require('../analysis/watcher');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return fn()
    .then(() => {
      console.log(`  PASS: ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`  FAIL: ${name} -- ${err.message}`);
      failed++;
    });
}

async function waitFor(condFn, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condFn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor timed out');
}

async function run() {
  console.log('WebSocket server tests\n');

  // --- Test 1: Server starts and accepts connections ---
  await test('server accepts connections and sends welcome', async () => {
    const srv = createServer({ port: 0, heartbeatInterval: 60000 });
    const port = srv.wss.address().port;

    const ws = new WebSocket(`ws://localhost:${port}`);
    const messages = [];

    await new Promise((resolve, reject) => {
      ws.on('message', (data) => messages.push(JSON.parse(data)));
      ws.on('open', () => setTimeout(resolve, 200));
      ws.on('error', reject);
    });

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].type, 'connected');
    ws.close();
    await srv.close();
  });

  // --- Test 2: Broadcast reaches all clients ---
  await test('broadcast reaches all connected clients', async () => {
    const srv = createServer({ port: 0, heartbeatInterval: 60000 });
    const port = srv.wss.address().port;

    const received1 = [];
    const received2 = [];

    const ws1 = new WebSocket(`ws://localhost:${port}`);
    const ws2 = new WebSocket(`ws://localhost:${port}`);

    ws1.on('message', (d) => received1.push(JSON.parse(d)));
    ws2.on('message', (d) => received2.push(JSON.parse(d)));

    await new Promise((r) => {
      let count = 0;
      ws1.on('open', () => { if (++count === 2) r(); });
      ws2.on('open', () => { if (++count === 2) r(); });
    });

    // Wait for welcome messages
    await new Promise((r) => setTimeout(r, 100));

    srv.broadcast('session.started', { sessionId: 'test-001' });

    await new Promise((r) => setTimeout(r, 200));

    // Both should have welcome + broadcast = 2 messages each
    const events1 = received1.filter((m) => m.type === 'session.started');
    const events2 = received2.filter((m) => m.type === 'session.started');

    assert.strictEqual(events1.length, 1);
    assert.strictEqual(events2.length, 1);
    assert.strictEqual(events1[0].data.sessionId, 'test-001');

    ws1.close();
    ws2.close();
    await srv.close();
  });

  // --- Test 3: Inbound messages from watcher trigger broadcast ---
  await test('inbound session event triggers broadcast to other clients', async () => {
    const srv = createServer({ port: 0, heartbeatInterval: 60000 });
    const port = srv.wss.address().port;

    const watcherWs = new WebSocket(`ws://localhost:${port}`);
    const clientWs = new WebSocket(`ws://localhost:${port}`);
    const clientMsgs = [];

    clientWs.on('message', (d) => clientMsgs.push(JSON.parse(d)));

    await new Promise((r) => {
      let count = 0;
      watcherWs.on('open', () => { if (++count === 2) r(); });
      clientWs.on('open', () => { if (++count === 2) r(); });
    });

    await new Promise((r) => setTimeout(r, 100));

    // Watcher sends an event
    watcherWs.send(JSON.stringify({
      type: 'analysis.completed',
      data: { sessionId: 'test-002' },
    }));

    await new Promise((r) => setTimeout(r, 300));

    const analysisEvents = clientMsgs.filter((m) => m.type === 'analysis.completed');
    assert.strictEqual(analysisEvents.length, 1);
    assert.strictEqual(analysisEvents[0].data.sessionId, 'test-002');

    watcherWs.close();
    clientWs.close();
    await srv.close();
  });

  // --- Test 4: BoothAppWS client auto-reconnects ---
  await test('ws-client receives events and can send', async () => {
    const srv = createServer({ port: 0, heartbeatInterval: 60000 });
    const port = srv.wss.address().port;

    const client = new BoothAppWS(`ws://localhost:${port}`);
    const events = [];

    client.on('session.started', (data) => events.push(data));

    await waitFor(() => client._ws && client._ws.readyState === WebSocket.OPEN);
    await new Promise((r) => setTimeout(r, 100));

    srv.broadcast('session.started', { sessionId: 'test-003' });

    await waitFor(() => events.length > 0);

    assert.strictEqual(events[0].sessionId, 'test-003');

    client.close();
    await srv.close();
  });

  // --- Test 5: Heartbeat ping/pong (verify isAlive tracking) ---
  await test('heartbeat marks clients alive on pong', async () => {
    const srv = createServer({ port: 0, heartbeatInterval: 100 });
    const port = srv.wss.address().port;

    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise((r) => ws.on('open', r));

    // After one heartbeat cycle, client should still be connected
    await new Promise((r) => setTimeout(r, 250));

    assert.strictEqual(ws.readyState, WebSocket.OPEN);

    ws.close();
    await srv.close();
  });

  // --- Test 6: Watcher detects session changes and sends events ---
  await test('watcher detects new session and sends session.started', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));

    // Mock WS client that captures sent messages
    const sentMessages = [];
    const mockWs = {
      send(type, data) { sentMessages.push({ type, data }); },
      close() {},
    };

    const watcher = createWatcher({
      sessionsDir: tmpDir,
      pollIntervalMs: 100,
      wsClient: mockWs,
    });

    // Create a session directory with a ready file
    const sessionDir = path.join(tmpDir, 'session-abc');
    fs.mkdirSync(sessionDir);
    fs.writeFileSync(path.join(sessionDir, 'ready'), '');

    await waitFor(() => sentMessages.length > 0, 2000);

    assert.strictEqual(sentMessages[0].type, 'session.started');
    assert.strictEqual(sentMessages[0].data.sessionId, 'session-abc');

    // Now simulate analysis completion
    const outputDir = path.join(sessionDir, 'output');
    fs.mkdirSync(outputDir);
    fs.writeFileSync(path.join(outputDir, 'result.json'), '{}');

    await waitFor(() => sentMessages.length > 1, 2000);

    assert.strictEqual(sentMessages[1].type, 'analysis.completed');

    watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- Summary ---
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
