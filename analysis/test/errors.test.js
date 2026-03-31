'use strict';

const assert = require('assert');
const { classifyError, retryWithBackoff } = require('../lib/errors');
const { writeErrorJson } = require('../lib/error-writer');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

console.log('--- classifyError ---');

// S3 access denied
{
  const c = classifyError({ code: 'AccessDenied', message: 'forbidden' });
  assert.strictEqual(c.type, 's3_access_denied');
  assert.strictEqual(c.retryable, false);
  console.log('  [PASS] S3 AccessDenied');
}

// S3 403 status
{
  const c = classifyError({ message: 'forbidden', $metadata: { httpStatusCode: 403 } });
  assert.strictEqual(c.type, 's3_access_denied');
  assert.strictEqual(c.retryable, false);
  console.log('  [PASS] S3 HTTP 403');
}

// Missing file - NoSuchKey
{
  const c = classifyError({ code: 'NoSuchKey', message: 'key not found', Key: 'recordings/abc/audio.webm' });
  assert.strictEqual(c.type, 'missing_file');
  assert.strictEqual(c.retryable, false);
  assert.strictEqual(c.detail, 'recordings/abc/audio.webm');
  console.log('  [PASS] S3 NoSuchKey');
}

// Missing file - ENOENT
{
  const c = classifyError({ code: 'ENOENT', message: 'no such file', path: '/tmp/x' });
  assert.strictEqual(c.type, 'missing_file');
  assert.strictEqual(c.detail, '/tmp/x');
  console.log('  [PASS] ENOENT');
}

// Throttling
{
  const c = classifyError({ code: 'ThrottlingException', message: 'rate exceeded' });
  assert.strictEqual(c.type, 'throttling');
  assert.strictEqual(c.retryable, true);
  console.log('  [PASS] ThrottlingException');
}

// HTTP 429
{
  const c = classifyError({ message: 'too many', $metadata: { httpStatusCode: 429 } });
  assert.strictEqual(c.type, 'throttling');
  assert.strictEqual(c.retryable, true);
  console.log('  [PASS] HTTP 429');
}

// Bedrock model not ready
{
  const c = classifyError({ code: 'ModelNotReadyException', message: 'warming up' });
  assert.strictEqual(c.type, 'bedrock_model');
  assert.strictEqual(c.retryable, true);
  console.log('  [PASS] ModelNotReadyException');
}

// Bedrock validation
{
  const c = classifyError({ code: 'ValidationException', message: 'bad input' });
  assert.strictEqual(c.type, 'bedrock_validation');
  assert.strictEqual(c.retryable, false);
  console.log('  [PASS] ValidationException');
}

// Network error
{
  const c = classifyError({ code: 'ECONNRESET', message: 'connection reset' });
  assert.strictEqual(c.type, 'network');
  assert.strictEqual(c.retryable, true);
  console.log('  [PASS] ECONNRESET');
}

// Unknown
{
  const c = classifyError({ message: 'something weird' });
  assert.strictEqual(c.type, 'unknown');
  assert.strictEqual(c.retryable, false);
  console.log('  [PASS] unknown error');
}

// ---------------------------------------------------------------------------
// retryWithBackoff
// ---------------------------------------------------------------------------

console.log('\n--- retryWithBackoff ---');

async function testRetry() {
  // Succeeds on first try
  {
    let calls = 0;
    const result = await retryWithBackoff(async () => { calls++; return 'ok'; }, { maxRetries: 3 });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 1);
    console.log('  [PASS] succeeds on first try');
  }

  // Retries transient then succeeds
  {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls++;
      if (calls < 3) {
        const err = new Error('throttled');
        err.code = 'ThrottlingException';
        throw err;
      }
      return 'recovered';
    }, { maxRetries: 3, baseDelayMs: 10 });
    assert.strictEqual(result, 'recovered');
    assert.strictEqual(calls, 3);
    console.log('  [PASS] retries transient, succeeds on 3rd');
  }

  // Does not retry non-retryable errors
  {
    let calls = 0;
    try {
      await retryWithBackoff(async () => {
        calls++;
        const err = new Error('denied');
        err.code = 'AccessDenied';
        throw err;
      }, { maxRetries: 3, baseDelayMs: 10 });
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'denied');
      assert.strictEqual(calls, 1);
      console.log('  [PASS] does not retry non-retryable');
    }
  }

  // Exhausts retries
  {
    let calls = 0;
    let retryCount = 0;
    try {
      await retryWithBackoff(async () => {
        calls++;
        const err = new Error('throttled');
        err.code = 'ThrottlingException';
        throw err;
      }, { maxRetries: 2, baseDelayMs: 10, onRetry: () => retryCount++ });
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(calls, 3); // initial + 2 retries
      assert.strictEqual(retryCount, 2);
      console.log('  [PASS] exhausts retries then throws');
    }
  }
}

// ---------------------------------------------------------------------------
// writeErrorJson
// ---------------------------------------------------------------------------

console.log('\n--- writeErrorJson ---');

function testErrorWriter() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boothapp-test-'));
  const sessionId = 'test-session-001';
  const err = new Error('access denied');
  err.code = 'AccessDenied';

  const filePath = writeErrorJson(tmpDir, sessionId, 'download', err);

  assert.ok(fs.existsSync(filePath));
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  assert.strictEqual(content.error, true);
  assert.strictEqual(content.sessionId, 'test-session-001');
  assert.strictEqual(content.stage, 'download');
  assert.strictEqual(content.type, 's3_access_denied');
  assert.strictEqual(content.retryable, false);
  assert.ok(content.timestamp);
  assert.ok(content.stack);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });
  console.log('  [PASS] writes structured error.json');
}

testErrorWriter();

// Run async tests
testRetry().then(() => {
  console.log('\nAll tests passed.');
}).catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
