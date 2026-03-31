'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PipelineError,
  classifyError,
  getRetryDelay,
  withRetry,
  RETRYABLE_ERROR_CODES,
  RETRY_DELAYS_MS,
  MAX_RETRIES,
} = require('../lib/errors');

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// PipelineError
// ---------------------------------------------------------------------------
describe('PipelineError', () => {
  it('sets name to PipelineError', () => {
    const err = new PipelineError('test');
    assert.equal(err.name, 'PipelineError');
  });

  it('stores code, stage, retryable, and cause', () => {
    const cause = new Error('original');
    const err = new PipelineError('wrapped', {
      code: 'ThrottlingException',
      stage: 'analyze',
      retryable: true,
      cause,
    });
    assert.equal(err.code, 'ThrottlingException');
    assert.equal(err.stage, 'analyze');
    assert.equal(err.retryable, true);
    assert.equal(err.cause, cause);
  });

  it('defaults to non-retryable with unknown code', () => {
    const err = new PipelineError('fail');
    assert.equal(err.retryable, false);
    assert.equal(err.code, 'UnknownError');
    assert.equal(err.stage, 'unknown');
    assert.equal(err.cause, null);
  });
});

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------
describe('classifyError', () => {
  it('classifies ThrottlingException as retryable', () => {
    const raw = new Error('Rate exceeded');
    raw.code = 'ThrottlingException';
    const classified = classifyError(raw, 'analyze');
    assert.equal(classified.retryable, true);
    assert.equal(classified.code, 'ThrottlingException');
    assert.equal(classified.stage, 'analyze');
  });

  it('classifies ServiceUnavailableException as retryable', () => {
    const raw = new Error('Service unavailable');
    raw.code = 'ServiceUnavailableException';
    assert.equal(classifyError(raw, 'analyze').retryable, true);
  });

  it('classifies TooManyRequestsException as retryable', () => {
    const raw = new Error('Too many');
    raw.code = 'TooManyRequestsException';
    assert.equal(classifyError(raw, 'analyze').retryable, true);
  });

  it('classifies RequestTimeout as retryable', () => {
    const raw = new Error('Timeout');
    raw.code = 'RequestTimeout';
    assert.equal(classifyError(raw, 'transcribe').retryable, true);
  });

  it('classifies InternalServerException as retryable', () => {
    const raw = new Error('Internal');
    raw.code = 'InternalServerException';
    assert.equal(classifyError(raw, 'analyze').retryable, true);
  });

  it('classifies AccessDeniedException as permanent', () => {
    const raw = new Error('Access denied');
    raw.code = 'AccessDeniedException';
    assert.equal(classifyError(raw, 'analyze').retryable, false);
  });

  it('classifies ValidationException as permanent', () => {
    const raw = new Error('Invalid');
    raw.code = 'ValidationException';
    assert.equal(classifyError(raw, 'analyze').retryable, false);
  });

  it('classifies unknown errors as permanent', () => {
    const raw = new Error('something');
    assert.equal(classifyError(raw, 'analyze').retryable, false);
  });

  it('uses err.name when err.code is missing', () => {
    const raw = new Error('throttled');
    raw.name = 'ThrottlingException';
    assert.equal(classifyError(raw, 'analyze').retryable, true);
  });

  it('uses err.__type when code and name are missing', () => {
    const raw = { message: 'throttled', __type: 'ThrottlingException' };
    assert.equal(classifyError(raw, 'analyze').retryable, true);
  });

  it('preserves the original error as cause', () => {
    const raw = new Error('orig');
    raw.code = 'ThrottlingException';
    const classified = classifyError(raw, 'analyze');
    assert.equal(classified.cause, raw);
  });
});

// ---------------------------------------------------------------------------
// getRetryDelay
// ---------------------------------------------------------------------------
describe('getRetryDelay', () => {
  it('returns 5000ms for attempt 0', () => {
    assert.equal(getRetryDelay(0), 5000);
  });

  it('returns 15000ms for attempt 1', () => {
    assert.equal(getRetryDelay(1), 15000);
  });

  it('returns 45000ms for attempt 2', () => {
    assert.equal(getRetryDelay(2), 45000);
  });

  it('returns null for attempt 3 (beyond max)', () => {
    assert.equal(getRetryDelay(3), null);
  });

  it('returns null for negative attempt', () => {
    assert.equal(getRetryDelay(-1), null);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('constants', () => {
  it('MAX_RETRIES equals RETRY_DELAYS_MS length', () => {
    assert.equal(MAX_RETRIES, RETRY_DELAYS_MS.length);
    assert.equal(MAX_RETRIES, 3);
  });

  it('RETRY_DELAYS_MS are 5s, 15s, 45s', () => {
    assert.deepEqual(RETRY_DELAYS_MS, [5000, 15000, 45000]);
  });

  it('RETRYABLE_ERROR_CODES includes expected codes', () => {
    assert.ok(RETRYABLE_ERROR_CODES.has('ThrottlingException'));
    assert.ok(RETRYABLE_ERROR_CODES.has('ServiceUnavailableException'));
    assert.ok(RETRYABLE_ERROR_CODES.has('TooManyRequestsException'));
    assert.ok(RETRYABLE_ERROR_CODES.has('RequestTimeout'));
    assert.ok(RETRYABLE_ERROR_CODES.has('InternalServerException'));
  });
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------
describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = async () => 'ok';
    const result = await withRetry(fn, 'test', { logger: () => {}, sleepFn: noSleep });
    assert.equal(result, 'ok');
  });

  it('retries on ThrottlingException then succeeds', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) {
        const err = new Error('throttled');
        err.code = 'ThrottlingException';
        throw err;
      }
      return 'success';
    };

    const logs = [];
    const result = await withRetry(fn, 'analyze', {
      logger: msg => logs.push(msg),
      sessionId: 'sess-001',
      sleepFn: noSleep,
    });

    assert.equal(result, 'success');
    assert.equal(calls, 3);
    assert.equal(logs.length, 2);
    assert.ok(logs[0].includes('attempt=1/3'));
    assert.ok(logs[1].includes('attempt=2/3'));
  });

  it('throws immediately on non-retryable error', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      const err = new Error('denied');
      err.code = 'AccessDeniedException';
      throw err;
    };

    await assert.rejects(
      () => withRetry(fn, 'analyze', { logger: () => {}, sleepFn: noSleep }),
      err => {
        assert.equal(err.code, 'AccessDeniedException');
        assert.equal(err.retryable, false);
        return true;
      }
    );
    assert.equal(calls, 1);
  });

  it('throws after MAX_RETRIES exhausted', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      const err = new Error('unavailable');
      err.code = 'ServiceUnavailableException';
      throw err;
    };

    const logs = [];
    await assert.rejects(
      () => withRetry(fn, 'analyze', {
        logger: msg => logs.push(msg),
        sessionId: 'sess-002',
        sleepFn: noSleep,
      }),
      err => {
        assert.ok(err.message.includes('retries exhausted'));
        assert.equal(err.retryable, true);
        return true;
      }
    );

    assert.equal(calls, 4); // 1 initial + 3 retries
    assert.equal(logs.length, 3);
  });

  it('logs include correct delay values', async () => {
    const fn = async () => {
      const err = new Error('throttled');
      err.code = 'ThrottlingException';
      throw err;
    };

    const logs = [];
    await assert.rejects(
      () => withRetry(fn, 'analyze', { logger: msg => logs.push(msg), sleepFn: noSleep })
    );

    assert.ok(logs[0].includes('delay=5000ms'));
    assert.ok(logs[1].includes('delay=15000ms'));
    assert.ok(logs[2].includes('delay=45000ms'));
  });

  it('logs include session ID and stage', async () => {
    let first = true;
    const fn = async () => {
      if (first) {
        first = false;
        const err = new Error('throttled');
        err.code = 'ThrottlingException';
        throw err;
      }
      return 'ok';
    };

    const logs = [];
    await withRetry(fn, 'transcribe', {
      logger: msg => logs.push(msg),
      sessionId: 'sess-xyz',
      sleepFn: noSleep,
    });

    assert.ok(logs[0].includes('session=sess-xyz'));
    assert.ok(logs[0].includes('stage=transcribe'));
  });

  it('records sleep delays passed to sleepFn', async () => {
    const delays = [];
    const fn = async () => {
      const err = new Error('throttled');
      err.code = 'ThrottlingException';
      throw err;
    };

    await assert.rejects(
      () => withRetry(fn, 'analyze', {
        logger: () => {},
        sleepFn: async (ms) => { delays.push(ms); },
      })
    );

    assert.deepEqual(delays, [5000, 15000, 45000]);
  });
});
