'use strict';

const assert = require('assert');
const { classifyError } = require('../lib/errors');

console.log('--- errors ---');

// S3 access denied
{
  const c = classifyError({ code: 'AccessDenied', message: 'no access' });
  assert.strictEqual(c.type, 's3_access_denied');
  assert.strictEqual(c.retryable, false);
  console.log('  [PASS] classifies AccessDenied');
}

// 403 status code
{
  const c = classifyError({ message: 'forbidden', $metadata: { httpStatusCode: 403 } });
  assert.strictEqual(c.type, 's3_access_denied');
  assert.strictEqual(c.retryable, false);
  console.log('  [PASS] classifies 403 as s3_access_denied');
}

// Missing file (NoSuchKey)
{
  const c = classifyError({ code: 'NoSuchKey', message: 'not found', Key: 'audio.webm' });
  assert.strictEqual(c.type, 'missing_file');
  assert.strictEqual(c.retryable, false);
  assert.strictEqual(c.detail, 'audio.webm');
  console.log('  [PASS] classifies NoSuchKey');
}

// ENOENT
{
  const c = classifyError({ code: 'ENOENT', message: 'no such file', path: '/tmp/x' });
  assert.strictEqual(c.type, 'missing_file');
  assert.strictEqual(c.detail, '/tmp/x');
  console.log('  [PASS] classifies ENOENT');
}

// Network errors
{
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED']) {
    const c = classifyError({ code, message: 'net err' });
    assert.strictEqual(c.type, 'network');
    assert.strictEqual(c.retryable, true);
  }
  console.log('  [PASS] classifies network codes as retryable');
}

// Throttling
{
  const c = classifyError({ code: 'ThrottlingException', message: 'slow down' });
  assert.strictEqual(c.type, 'throttling');
  assert.strictEqual(c.retryable, true);
  console.log('  [PASS] classifies ThrottlingException');
}

// 429 status
{
  const c = classifyError({ message: 'rate limit', $metadata: { httpStatusCode: 429 } });
  assert.strictEqual(c.type, 'throttling');
  assert.strictEqual(c.retryable, true);
  console.log('  [PASS] classifies 429 as throttling');
}

// 503 status
{
  const c = classifyError({ message: 'unavail', $metadata: { httpStatusCode: 503 } });
  assert.strictEqual(c.type, 'throttling');
  assert.strictEqual(c.retryable, true);
  console.log('  [PASS] classifies 503 as throttling');
}

// Bedrock model errors (retryable)
{
  const c = classifyError({ code: 'ModelNotReadyException', message: 'warming' });
  assert.strictEqual(c.type, 'bedrock_model');
  assert.strictEqual(c.retryable, true);
  console.log('  [PASS] classifies ModelNotReadyException as retryable');
}

// Bedrock validation (not retryable)
{
  const c = classifyError({ code: 'ValidationException', message: 'bad input' });
  assert.strictEqual(c.type, 'bedrock_validation');
  assert.strictEqual(c.retryable, false);
  console.log('  [PASS] classifies ValidationException as not retryable');
}

// Pipeline timeout
{
  const c = classifyError({ code: 'PIPELINE_TIMEOUT', message: 'timed out' });
  assert.strictEqual(c.type, 'timeout');
  assert.strictEqual(c.retryable, false);
  console.log('  [PASS] classifies PIPELINE_TIMEOUT');
}

// Unknown error
{
  const c = classifyError({ message: 'something weird' });
  assert.strictEqual(c.type, 'unknown');
  assert.strictEqual(c.retryable, false);
  console.log('  [PASS] classifies unknown errors');
}

console.log('\nAll errors tests passed.');
