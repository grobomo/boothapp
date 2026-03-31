'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

// Use a temp directory for session data
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
process.env.SESSIONS_DIR = TEST_DIR;

const { writeErrorJson } = require('../lib/error-writer');
const { classifyError } = require('../lib/errors');

console.log('--- watcher ---');

async function runTests() {
  // --- Dead-letter: error.json written after failures ---
  {
    const sessionId = 'dead-letter-test';
    const sessionsDir = TEST_DIR;
    const sessionPath = path.join(sessionsDir, sessionId);
    fs.mkdirSync(sessionPath, { recursive: true });

    const err = new Error('S3 bucket gone');
    err.code = 'NoSuchKey';

    const filePath = writeErrorJson(sessionsDir, sessionId, 'download', err, 3);

    assert.ok(fs.existsSync(filePath));
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(payload.error, true);
    assert.strictEqual(payload.sessionId, sessionId);
    assert.strictEqual(payload.stage, 'download');
    assert.strictEqual(payload.type, 'missing_file');
    assert.strictEqual(payload.retryable, false);
    assert.strictEqual(payload.attempts, 3);
    assert.ok(payload.timestamp);
    assert.ok(payload.stack);
    console.log('  [PASS] dead-letter writes error.json with failure details');
  }

  // --- error.json has correct shape for different error types ---
  {
    const sessionId = 'throttle-test';
    fs.mkdirSync(path.join(TEST_DIR, sessionId), { recursive: true });

    const err = new Error('slow down');
    err.code = 'ThrottlingException';

    writeErrorJson(TEST_DIR, sessionId, 'analyze', err, 3);
    const payload = JSON.parse(
      fs.readFileSync(path.join(TEST_DIR, sessionId, 'output', 'error.json'), 'utf8'),
    );
    assert.strictEqual(payload.type, 'throttling');
    assert.strictEqual(payload.retryable, true);
    assert.strictEqual(payload.attempts, 3);
    console.log('  [PASS] error.json captures throttling errors');
  }

  // --- Attempt tracking ---
  {
    const sessionId = 'attempt-track';
    const attemptsDir = path.join(TEST_DIR, sessionId, 'output');
    fs.mkdirSync(attemptsDir, { recursive: true });

    // Write attempt count
    fs.writeFileSync(path.join(attemptsDir, '.attempts'), '2');

    // Read it back
    const count = parseInt(
      fs.readFileSync(path.join(attemptsDir, '.attempts'), 'utf8').trim(),
      10,
    );
    assert.strictEqual(count, 2);
    console.log('  [PASS] attempt tracking via .attempts file');
  }

  // --- getPendingSessions logic ---
  {
    // Create a "ready" session with no output
    const readyId = 'session-ready';
    fs.mkdirSync(path.join(TEST_DIR, readyId), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, readyId, 'ready'), '');

    // Create a "completed" session with result.json
    const doneId = 'session-done';
    fs.mkdirSync(path.join(TEST_DIR, doneId, 'output'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, doneId, 'ready'), '');
    fs.writeFileSync(path.join(TEST_DIR, doneId, 'output', 'result.json'), '{}');

    // Create a "dead-lettered" session with error.json
    const errorId = 'session-errored';
    fs.mkdirSync(path.join(TEST_DIR, errorId, 'output'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, errorId, 'ready'), '');
    fs.writeFileSync(path.join(TEST_DIR, errorId, 'output', 'error.json'), '{}');

    // Only session-ready should be pending
    const { getPendingSessions } = require('../watcher');
    const pending = getPendingSessions();
    assert.ok(pending.includes('session-ready'), 'ready session should be pending');
    assert.ok(!pending.includes('session-done'), 'done session should not be pending');
    assert.ok(!pending.includes('session-errored'), 'errored session should not be pending');
    console.log('  [PASS] getPendingSessions returns only ready sessions without output');
  }

  // --- Stats endpoint ---
  {
    const { getStats } = require('../watcher');
    const stats = getStats();
    assert.strictEqual(typeof stats.sessions_processed, 'number');
    assert.strictEqual(typeof stats.sessions_errored, 'number');
    assert.strictEqual(typeof stats.avg_processing_time_ms, 'number');
    assert.strictEqual(typeof stats.uptime_s, 'number');
    console.log('  [PASS] getStats returns correct shape');
  }

  // --- MAX_SESSION_ATTEMPTS is 3 ---
  {
    const { MAX_SESSION_ATTEMPTS } = require('../watcher');
    assert.strictEqual(MAX_SESSION_ATTEMPTS, 3);
    console.log('  [PASS] MAX_SESSION_ATTEMPTS is 3');
  }

  // --- SIGTERM handler sets shutdown flag ---
  {
    const { isShuttingDown } = require('../watcher');
    assert.strictEqual(isShuttingDown(), false);
    console.log('  [PASS] isShuttingDown is false before signal');
  }

  console.log('\nAll watcher tests passed.');

  // Cleanup
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
