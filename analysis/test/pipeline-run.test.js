'use strict';

const assert = require('assert');
const { withTimeout } = require('../pipeline-run');

console.log('--- pipeline-run (withTimeout) ---');

async function runTests() {
  // Resolves before timeout
  {
    const result = await withTimeout(Promise.resolve('done'), 1000, 'test-stage');
    assert.strictEqual(result, 'done');
    console.log('  [PASS] resolves before timeout');
  }

  // Rejects before timeout
  {
    try {
      await withTimeout(Promise.reject(new Error('boom')), 1000, 'test-stage');
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'boom');
      console.log('  [PASS] rejects before timeout preserves original error');
    }
  }

  // Times out
  {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      await withTimeout(slow, 50, 'slow-stage');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('slow-stage'));
      assert.ok(err.message.includes('timed out'));
      assert.strictEqual(err.code, 'PIPELINE_STAGE_TIMEOUT');
      console.log('  [PASS] times out with descriptive error');
    }
  }

  console.log('\nAll pipeline-run tests passed.');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
