'use strict';

const assert = require('assert');
const { withTimeout, DEFAULT_STAGE_TIMEOUT_MS } = require('../pipeline-run');

console.log('--- pipeline-run ---');

async function runTests() {
  // Default timeout is 5 minutes
  {
    assert.strictEqual(DEFAULT_STAGE_TIMEOUT_MS, 5 * 60 * 1000);
    console.log('  [PASS] default timeout is 5 minutes');
  }

  // withTimeout resolves when promise resolves within limit
  {
    const result = await withTimeout(
      Promise.resolve('fast'),
      1000,
      'test-stage',
    );
    assert.strictEqual(result, 'fast');
    console.log('  [PASS] resolves when within timeout');
  }

  // withTimeout rejects when promise rejects
  {
    try {
      await withTimeout(
        Promise.reject(new Error('inner fail')),
        1000,
        'test-stage',
      );
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'inner fail');
      console.log('  [PASS] propagates inner rejection');
    }
  }

  // withTimeout rejects on timeout with correct error shape
  {
    const slow = new Promise(() => {}); // never resolves
    try {
      await withTimeout(slow, 50, 'slow-stage');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('slow-stage'));
      assert.ok(err.message.includes('timed out'));
      assert.strictEqual(err.code, 'PIPELINE_STAGE_TIMEOUT');
      assert.strictEqual(err.stage, 'slow-stage');
      console.log('  [PASS] rejects on timeout with correct error shape');
    }
  }

  // withTimeout clears timer on fast resolve (no leaked timers)
  {
    const start = Date.now();
    await withTimeout(Promise.resolve('done'), 60000, 'no-leak');
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, 'should resolve immediately, not wait for timeout');
    console.log('  [PASS] clears timer on fast resolve');
  }

  console.log('\nAll pipeline-run tests passed.');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
