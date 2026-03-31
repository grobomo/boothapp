'use strict';

const assert = require('assert');
const { withTimeout, DEFAULT_STAGE_TIMEOUT_MS } = require('../pipeline-run');

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

console.log('--- withTimeout ---');

async function runTests() {
  // Resolves when fn completes before timeout
  {
    const result = await withTimeout(
      () => Promise.resolve('fast'),
      1000,
      'test-fast',
    );
    assert.strictEqual(result, 'fast');
    console.log('  [PASS] resolves when fn completes before timeout');
  }

  // Rejects with timeout error when fn is too slow
  {
    try {
      await withTimeout(
        () => new Promise((r) => setTimeout(() => r('slow'), 500)),
        50,
        'test-slow',
      );
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('timed out'));
      assert.ok(err.message.includes('test-slow'));
      assert.ok(err.message.includes('50ms'));
      console.log('  [PASS] rejects with timeout error when fn exceeds limit');
    }
  }

  // Passes through fn rejection (not timeout)
  {
    try {
      await withTimeout(
        () => Promise.reject(new Error('fn broke')),
        1000,
        'test-reject',
      );
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'fn broke');
      console.log('  [PASS] passes through fn rejection');
    }
  }

  // Default timeout constant is 5 minutes
  {
    assert.strictEqual(DEFAULT_STAGE_TIMEOUT_MS, 5 * 60 * 1000);
    console.log('  [PASS] DEFAULT_STAGE_TIMEOUT_MS is 5 minutes');
  }
}

runTests().then(() => {
  console.log('\nAll pipeline-run tests passed.');
}).catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
