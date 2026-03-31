'use strict';

const assert = require('assert');
const { retry } = require('../lib/retry');

console.log('--- retry utility ---');

async function runTests() {
  // Succeeds on first try
  {
    let calls = 0;
    const result = await retry(async () => { calls++; return 'ok'; }, { maxRetries: 3 });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 1);
    console.log('  [PASS] succeeds on first try');
  }

  // Retries then succeeds
  {
    let calls = 0;
    const result = await retry(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'recovered';
    }, { maxRetries: 3, baseDelayMs: 10 });
    assert.strictEqual(result, 'recovered');
    assert.strictEqual(calls, 3);
    console.log('  [PASS] retries transient, succeeds on 3rd');
  }

  // Respects shouldRetry predicate
  {
    let calls = 0;
    try {
      await retry(async () => {
        calls++;
        const err = new Error('permanent');
        err.permanent = true;
        throw err;
      }, {
        maxRetries: 3,
        baseDelayMs: 10,
        shouldRetry: (err) => !err.permanent,
      });
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'permanent');
      assert.strictEqual(calls, 1);
      console.log('  [PASS] does not retry when shouldRetry returns false');
    }
  }

  // Exhausts retries and throws
  {
    let calls = 0;
    let retryAttempts = [];
    try {
      await retry(async () => {
        calls++;
        throw new Error('always fails');
      }, {
        maxRetries: 2,
        baseDelayMs: 10,
        onRetry: (err, attempt, delayMs) => {
          retryAttempts.push({ attempt, delayMs });
        },
      });
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'always fails');
      assert.strictEqual(calls, 3); // initial + 2 retries
      assert.strictEqual(retryAttempts.length, 2);
      assert.strictEqual(retryAttempts[0].attempt, 1);
      assert.strictEqual(retryAttempts[1].attempt, 2);
      console.log('  [PASS] exhausts retries then throws');
    }
  }

  // Exponential backoff delays increase
  {
    let delays = [];
    try {
      await retry(async () => { throw new Error('fail'); }, {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 50000,
        onRetry: (err, attempt, delayMs) => { delays.push(delayMs); },
      });
    } catch (_) { /* expected */ }
    // Each delay should be roughly double the previous (with jitter)
    assert.ok(delays[1] > delays[0], `delay[1]=${delays[1]} should be > delay[0]=${delays[0]}`);
    assert.ok(delays[2] > delays[1], `delay[2]=${delays[2]} should be > delay[1]=${delays[1]}`);
    console.log('  [PASS] delays increase exponentially');
  }

  // Respects maxDelayMs cap
  {
    let delays = [];
    try {
      await retry(async () => { throw new Error('fail'); }, {
        maxRetries: 5,
        baseDelayMs: 10000,
        maxDelayMs: 15000,
        onRetry: (err, attempt, delayMs) => { delays.push(delayMs); },
      });
    } catch (_) { /* expected */ }
    for (const d of delays) {
      assert.ok(d <= 15000, `delay ${d} should be <= maxDelayMs 15000`);
    }
    console.log('  [PASS] respects maxDelayMs cap');
  }

  // Zero retries means single attempt
  {
    let calls = 0;
    try {
      await retry(async () => { calls++; throw new Error('fail'); }, { maxRetries: 0 });
    } catch (_) { /* expected */ }
    assert.strictEqual(calls, 1);
    console.log('  [PASS] maxRetries=0 means single attempt');
  }

  console.log('\nAll retry tests passed.');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
