#!/usr/bin/env node
'use strict';

const { withRetry } = require('../lib/retry');

let failures = 0;

function assert(condition, label) {
  if (!condition) {
    console.error('  FAIL: ' + label);
    failures++;
  } else {
    console.log('  PASS: ' + label);
  }
}

(async () => {
  // Test 1: succeeds on first attempt
  console.log('Test 1: succeeds immediately');
  {
    let calls = 0;
    const result = await withRetry('t1', async () => { calls++; return 42; }, { maxRetries: 3, baseDelayMs: 10 });
    assert(result === 42, 'returns result');
    assert(calls === 1, 'called once');
  }

  // Test 2: retries and recovers
  console.log('Test 2: retries on transient failure');
  {
    let calls = 0;
    const result = await withRetry('t2', async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    }, { maxRetries: 3, baseDelayMs: 10 });
    assert(result === 'ok', 'recovered');
    assert(calls === 3, 'took 3 attempts');
  }

  // Test 3: exhausts retries and throws
  console.log('Test 3: throws after max retries');
  {
    let calls = 0;
    let threw = false;
    try {
      await withRetry('t3', async () => { calls++; throw new Error('permanent'); }, { maxRetries: 2, baseDelayMs: 10 });
    } catch (err) {
      threw = true;
      assert(err.message === 'permanent', 'preserves error message');
    }
    assert(threw, 'threw');
    assert(calls === 2, 'called maxRetries times');
  }

  // Test 4: onRetry callback fires
  console.log('Test 4: onRetry callback');
  {
    let calls = 0;
    const retries = [];
    await withRetry('t4', async () => {
      calls++;
      if (calls < 2) throw new Error('fail');
      return 'ok';
    }, {
      maxRetries: 3,
      baseDelayMs: 10,
      onRetry: (err, attempt, delay) => retries.push({ attempt, delay }),
    });
    assert(retries.length === 1, 'onRetry called once');
    assert(retries[0].attempt === 1, 'attempt is 1');
    assert(retries[0].delay === 10, 'delay is baseDelayMs');
  }

  // Test 5: exponential backoff delays
  console.log('Test 5: exponential backoff');
  {
    let calls = 0;
    const retries = [];
    try {
      await withRetry('t5', async () => { calls++; throw new Error('fail'); }, {
        maxRetries: 4,
        baseDelayMs: 10,
        onRetry: (err, attempt, delay) => retries.push(delay),
      });
    } catch (e) { /* expected */ }
    assert(retries.length === 3, '3 retries before final throw');
    assert(retries[0] === 10, 'first delay = 10');
    assert(retries[1] === 20, 'second delay = 20');
    assert(retries[2] === 40, 'third delay = 40');
  }

  // Test 6: custom multiplier (3x backoff for Bedrock retries)
  console.log('Test 6: custom multiplier (3x)');
  {
    const retries = [];
    try {
      await withRetry('t6', async () => { throw new Error('fail'); }, {
        maxRetries: 4,
        baseDelayMs: 100,
        multiplier: 3,
        onRetry: (err, attempt, delay) => retries.push(delay),
      });
    } catch (e) { /* expected */ }
    assert(retries.length === 3, '3 retries before final throw');
    assert(retries[0] === 100, 'first delay = 100 (100*3^0)');
    assert(retries[1] === 300, 'second delay = 300 (100*3^1)');
    assert(retries[2] === 900, 'third delay = 900 (100*3^2)');
  }

  // Test 7: isRetryable stops retry on non-retryable errors
  console.log('Test 7: isRetryable — non-retryable error fails immediately');
  {
    let calls = 0;
    let threw = false;
    try {
      await withRetry('t7', async () => { calls++; throw new Error('bad input'); }, {
        maxRetries: 4,
        baseDelayMs: 1,
        isRetryable: (err) => err.message.includes('timeout'),
      });
    } catch (err) {
      threw = true;
      assert(err.message === 'bad input', 'preserves error');
    }
    assert(threw, 'threw');
    assert(calls === 1, 'only 1 attempt (no retries)');
  }

  // Test 8: isRetryable allows retry on matching errors
  console.log('Test 8: isRetryable — retryable error retries normally');
  {
    let calls = 0;
    try {
      await withRetry('t8', async () => { calls++; throw new Error('timeout exceeded'); }, {
        maxRetries: 3,
        baseDelayMs: 1,
        isRetryable: (err) => err.message.includes('timeout'),
      });
    } catch (e) { /* expected */ }
    assert(calls === 3, 'retried all 3 attempts');
  }

  // Test 9: isRetryable with recovery on retryable error
  console.log('Test 9: isRetryable — recovers after retryable failures');
  {
    let calls = 0;
    const result = await withRetry('t9', async () => {
      calls++;
      if (calls < 3) throw new Error('ThrottlingException');
      return 'recovered';
    }, {
      maxRetries: 4,
      baseDelayMs: 1,
      isRetryable: (err) => err.message.includes('Throttling'),
    });
    assert(result === 'recovered', 'recovered after retries');
    assert(calls === 3, 'took 3 attempts');
  }

  console.log('');
  if (failures === 0) {
    console.log('All retry tests passed.');
  } else {
    console.log(failures + ' test(s) failed.');
    process.exit(1);
  }
})().catch((err) => {
  console.error('Unexpected: ' + err.message);
  process.exit(1);
});
