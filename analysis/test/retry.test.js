'use strict';

const assert = require('assert');
const { retryWithExponentialBackoff } = require('../lib/retry');

console.log('--- retryWithExponentialBackoff ---');

async function runTests() {
  // Succeeds on first try
  {
    let calls = 0;
    const result = await retryWithExponentialBackoff(
      async () => { calls++; return 'ok'; },
      { maxRetries: 2 },
    );
    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 1);
    console.log('  [PASS] succeeds on first try');
  }

  // Retries transient then succeeds
  {
    let calls = 0;
    const result = await retryWithExponentialBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'recovered';
      },
      { maxRetries: 2, baseDelayMs: 10 },
    );
    assert.strictEqual(result, 'recovered');
    assert.strictEqual(calls, 3);
    console.log('  [PASS] retries and recovers on 3rd attempt');
  }

  // Respects shouldRetry predicate
  {
    let calls = 0;
    try {
      await retryWithExponentialBackoff(
        async () => {
          calls++;
          const err = new Error('permanent');
          err.permanent = true;
          throw err;
        },
        {
          maxRetries: 2,
          baseDelayMs: 10,
          shouldRetry: (err) => !err.permanent,
        },
      );
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'permanent');
      assert.strictEqual(calls, 1);
      console.log('  [PASS] does not retry when shouldRetry returns false');
    }
  }

  // Exhausts retries
  {
    let calls = 0;
    let retryCount = 0;
    try {
      await retryWithExponentialBackoff(
        async () => { calls++; throw new Error('fail'); },
        {
          maxRetries: 2,
          baseDelayMs: 10,
          onRetry: () => retryCount++,
        },
      );
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(calls, 3); // initial + 2 retries
      assert.strictEqual(retryCount, 2);
      console.log('  [PASS] exhausts retries then throws');
    }
  }

  // onRetry receives correct arguments
  {
    const retryArgs = [];
    try {
      await retryWithExponentialBackoff(
        async () => { throw new Error('boom'); },
        {
          maxRetries: 1,
          baseDelayMs: 10,
          onRetry: (err, attempt, delay) => retryArgs.push({ msg: err.message, attempt, delay }),
        },
      );
    } catch (e) { /* expected */ }
    assert.strictEqual(retryArgs.length, 1);
    assert.strictEqual(retryArgs[0].msg, 'boom');
    assert.strictEqual(retryArgs[0].attempt, 1);
    assert.ok(retryArgs[0].delay > 0);
    console.log('  [PASS] onRetry receives correct arguments');
  }

  // Respects maxDelayMs cap
  {
    const delays = [];
    try {
      await retryWithExponentialBackoff(
        async () => { throw new Error('fail'); },
        {
          maxRetries: 2,
          baseDelayMs: 100,
          maxDelayMs: 50,
          onRetry: (err, attempt, delay) => delays.push(delay),
        },
      );
    } catch (e) { /* expected */ }
    for (const d of delays) {
      assert.ok(d <= 50, `delay ${d} exceeds maxDelayMs 50`);
    }
    console.log('  [PASS] delays capped at maxDelayMs');
  }

  console.log('\nAll retry tests passed.');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
