'use strict';

const assert = require('assert');
const { withTimeout, runStageWithTimeout } = require('../pipeline-run');

console.log('--- pipeline-run timeout ---');

async function runTests() {
  // withTimeout resolves when promise completes in time
  {
    const result = await withTimeout(Promise.resolve('fast'), 1000, 'test');
    assert.strictEqual(result, 'fast');
    console.log('  [PASS] resolves when within timeout');
  }

  // withTimeout rejects on timeout
  {
    try {
      await withTimeout(
        new Promise((resolve) => setTimeout(resolve, 500)),
        50,
        'slow-stage',
      );
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.code, 'StageTimeoutError');
      assert.ok(err.message.includes('slow-stage'));
      assert.ok(err.message.includes('50ms'));
      console.log('  [PASS] rejects with StageTimeoutError on timeout');
    }
  }

  // withTimeout propagates original error
  {
    try {
      await withTimeout(Promise.reject(new Error('original')), 1000, 'test');
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'original');
      console.log('  [PASS] propagates original error');
    }
  }

  // runStageWithTimeout works with a stage function
  {
    const result = await runStageWithTimeout(
      async () => 'stage-result',
      'download',
      1000,
    );
    assert.strictEqual(result, 'stage-result');
    console.log('  [PASS] runStageWithTimeout resolves');
  }

  // runStageWithTimeout times out
  {
    try {
      await runStageWithTimeout(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
        'transcribe',
        50,
      );
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.code, 'StageTimeoutError');
      assert.ok(err.message.includes('transcribe'));
      console.log('  [PASS] runStageWithTimeout times out');
    }
  }

  console.log('\nAll pipeline-run tests passed.');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
