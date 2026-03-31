'use strict';

const assert = require('assert');
const { retry } = require('../lib/retry');

console.log('--- retry utility ---');

async function runTests() {
  // Succeeds on first try
  {
    let calls = 0;
    const result = await retry(async () => { calls++; return 42; });
    assert.strictEqual(result, 42);
    assert.strictEqual(calls, 1);
    console.log('  [PASS] succeeds on first try');
  }

  // Retries and succeeds
  {
    let calls = 0;
    const result = await retry(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    }, { maxRetries: 3, baseDelayMs: 10 });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 3);
    console.log('  [PASS] retries transient error, succeeds on 3rd');
  }

  // shouldRetry=false stops immediately
  {
    let calls = 0;
    try {
      await retry(async () => {
        calls++;
        throw new Error('permanent');
      }, { maxRetries: 3, baseDelayMs: 10, shouldRetry: () => false });
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'permanent');
      assert.strictEqual(calls, 1);
      console.log('  [PASS] shouldRetry=false stops immediately');
    }
  }

  // Exhausts retries
  {
    let calls = 0;
    let retryCount = 0;
    try {
      await retry(async () => {
        calls++;
        throw new Error('always fails');
      }, {
        maxRetries: 2,
        baseDelayMs: 10,
        onRetry: () => retryCount++,
      });
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
    let calls = 0;
    try {
      await retry(async () => {
        calls++;
        throw new Error('fail');
      }, {
        maxRetries: 2,
        baseDelayMs: 10,
        onRetry: (err, attempt, delayMs) => {
          retryArgs.push({ msg: err.message, attempt, delayMs });
        },
      });
    } catch (_) {}
    assert.strictEqual(retryArgs.length, 2);
    assert.strictEqual(retryArgs[0].attempt, 1);
    assert.strictEqual(retryArgs[1].attempt, 2);
    assert.ok(retryArgs[0].delayMs > 0);
    console.log('  [PASS] onRetry callback receives correct args');
  }

  // Delay is capped by maxDelayMs
  {
    const delays = [];
    let calls = 0;
    try {
      await retry(async () => {
        calls++;
        throw new Error('fail');
      }, {
        maxRetries: 5,
        baseDelayMs: 10000,
        maxDelayMs: 50,
        onRetry: (_, __, delayMs) => delays.push(delayMs),
      });
    } catch (_) {}
    for (const d of delays) {
      assert.ok(d <= 60, `delay ${d} should be <= 60 (50 + jitter margin)`);
    }
    console.log('  [PASS] delay capped by maxDelayMs');
  }

  console.log('\nAll retry tests passed.');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
