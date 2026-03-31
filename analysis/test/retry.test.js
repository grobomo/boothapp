'use strict';

const assert = require('assert');
const { retry } = require('../lib/retry');

// ---------------------------------------------------------------------------
// retry utility
// ---------------------------------------------------------------------------

console.log('--- retry ---');

async function runTests() {
  // Succeeds on first attempt
  {
    let calls = 0;
    const result = await retry(async () => { calls++; return 42; }, { maxRetries: 3 });
    assert.strictEqual(result, 42);
    assert.strictEqual(calls, 1);
    console.log('  [PASS] succeeds on first attempt');
  }

  // Retries and recovers
  {
    let calls = 0;
    const result = await retry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'recovered';
      },
      { maxRetries: 3, baseDelayMs: 10 },
    );
    assert.strictEqual(result, 'recovered');
    assert.strictEqual(calls, 3);
    console.log('  [PASS] retries transient errors and recovers');
  }

  // Respects shouldRetry predicate -- does not retry when false
  {
    let calls = 0;
    try {
      await retry(
        async () => {
          calls++;
          throw new Error('permanent');
        },
        {
          maxRetries: 3,
          baseDelayMs: 10,
          shouldRetry: () => false,
        },
      );
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'permanent');
      assert.strictEqual(calls, 1);
      console.log('  [PASS] does not retry when shouldRetry returns false');
    }
  }

  // Exhausts all retries then throws
  {
    let calls = 0;
    let retryCallbacks = 0;
    try {
      await retry(
        async () => {
          calls++;
          throw new Error('always fails');
        },
        {
          maxRetries: 2,
          baseDelayMs: 10,
          onRetry: () => retryCallbacks++,
        },
      );
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'always fails');
      assert.strictEqual(calls, 3); // 1 initial + 2 retries
      assert.strictEqual(retryCallbacks, 2);
      console.log('  [PASS] exhausts retries then throws');
    }
  }

  // onRetry receives correct arguments
  {
    const retryArgs = [];
    let calls = 0;
    await retry(
      async () => {
        calls++;
        if (calls < 2) throw new Error('once');
        return 'ok';
      },
      {
        maxRetries: 2,
        baseDelayMs: 10,
        onRetry: (err, attempt, delayMs) => {
          retryArgs.push({ msg: err.message, attempt, delayMs });
        },
      },
    );
    assert.strictEqual(retryArgs.length, 1);
    assert.strictEqual(retryArgs[0].msg, 'once');
    assert.strictEqual(retryArgs[0].attempt, 1);
    assert.ok(typeof retryArgs[0].delayMs === 'number');
    assert.ok(retryArgs[0].delayMs > 0);
    console.log('  [PASS] onRetry receives (err, attempt, delayMs)');
  }

  // Zero maxRetries means no retries
  {
    let calls = 0;
    try {
      await retry(
        async () => {
          calls++;
          throw new Error('no retry');
        },
        { maxRetries: 0, baseDelayMs: 10 },
      );
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(calls, 1);
      console.log('  [PASS] maxRetries=0 means no retries');
    }
  }
}

runTests().then(() => {
  console.log('\nAll retry tests passed.');
}).catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
