'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { processSession, pollOnce } = require('../watcher');

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
function mockS3({ sessions = [], hasReady = true, hasOutput = false } = {}) {
  return {
    listObjectsV2: () => ({
      promise: async () => ({
        CommonPrefixes: sessions.map(id => ({ Prefix: `sessions/${id}/` })),
      }),
    }),
    headObject: (params) => ({
      promise: async () => {
        const key = params.Key;
        if (key.endsWith('/ready') && !hasReady) {
          throw new Error('NotFound');
        }
        if ((key.endsWith('result.json') || key.endsWith('error.json')) && !hasOutput) {
          throw new Error('NotFound');
        }
        return {};
      },
    }),
    getObject: (params) => ({
      promise: async () => ({
        Body: Buffer.from(JSON.stringify({
          session_id: params.Key.split('/')[1],
          visitor: { name: 'Test Visitor' },
          clicks: [],
          transcript: [],
        })),
      }),
    }),
    putObject: () => ({
      promise: async () => ({}),
    }),
  };
}

function baseDeps(overrides = {}) {
  return {
    s3Client: mockS3(),
    bucket: 'test-bucket',
    transcriber: async () => ({ text: 'hello' }),
    correlator: (data, transcript) => ({ ...data, transcript }),
    bedrockClient: async (data) => ({ analysis: 'done', ...data }),
    resultWriter: async () => {},
    logger: () => {},
    sleepFn: noSleep,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// processSession
// ---------------------------------------------------------------------------
describe('processSession', () => {
  it('returns true on successful pipeline run', async () => {
    const result = await processSession({ session_id: 'sess-001' }, baseDeps());
    assert.equal(result, true);
  });

  it('returns false and writes error.json on permanent failure', async () => {
    let errorWritten = false;
    const s3 = mockS3();
    s3.putObject = () => ({
      promise: async () => { errorWritten = true; },
    });

    const result = await processSession(
      { session_id: 'sess-002' },
      baseDeps({
        s3Client: s3,
        transcriber: async () => {
          const err = new Error('denied');
          err.code = 'AccessDeniedException';
          throw err;
        },
      })
    );

    assert.equal(result, false);
    assert.equal(errorWritten, true);
  });

  it('returns false after retries exhausted on ThrottlingException', async () => {
    let bedrockCalls = 0;
    const result = await processSession(
      { session_id: 'sess-003' },
      baseDeps({
        bedrockClient: async () => {
          bedrockCalls++;
          const err = new Error('throttled');
          err.code = 'ThrottlingException';
          throw err;
        },
      })
    );

    assert.equal(result, false);
    assert.equal(bedrockCalls, 4); // 1 initial + 3 retries
  });

  it('succeeds after transient failures then recovery', async () => {
    let calls = 0;
    const result = await processSession(
      { session_id: 'sess-004' },
      baseDeps({
        bedrockClient: async () => {
          calls++;
          if (calls < 3) {
            const err = new Error('unavailable');
            err.code = 'ServiceUnavailableException';
            throw err;
          }
          return { analysis: 'recovered' };
        },
      })
    );

    assert.equal(result, true);
    assert.equal(calls, 3);
  });

  it('continues to next session after one fails', async () => {
    const processed = [];

    for (const id of ['sess-A', 'sess-B']) {
      const success = await processSession(
        { session_id: id },
        baseDeps({
          transcriber: async () => {
            if (id === 'sess-A') {
              const err = new Error('denied');
              err.code = 'AccessDeniedException';
              throw err;
            }
            return { text: 'ok' };
          },
        })
      );
      processed.push({ id, success });
    }

    assert.equal(processed[0].success, false);
    assert.equal(processed[1].success, true);
  });

  it('logs retry attempts for transient errors', async () => {
    const logs = [];
    let calls = 0;

    await processSession(
      { session_id: 'sess-log' },
      baseDeps({
        logger: msg => logs.push(msg),
        bedrockClient: async () => {
          calls++;
          if (calls === 1) {
            const err = new Error('throttled');
            err.code = 'ThrottlingException';
            throw err;
          }
          return { ok: true };
        },
      })
    );

    const retryLogs = logs.filter(l => l.includes('[retry]'));
    assert.equal(retryLogs.length, 1);
    assert.ok(retryLogs[0].includes('attempt=1/3'));
  });
});

// ---------------------------------------------------------------------------
// pollOnce
// ---------------------------------------------------------------------------
describe('pollOnce', () => {
  it('processes ready sessions and returns counts', async () => {
    const result = await pollOnce(
      baseDeps({ s3Client: mockS3({ sessions: ['sess-X', 'sess-Y'] }) })
    );

    assert.equal(result.processed, 2);
    assert.equal(result.failed, 0);
  });

  it('counts failures separately from successes', async () => {
    let callCount = 0;
    const result = await pollOnce(
      baseDeps({
        s3Client: mockS3({ sessions: ['sess-1', 'sess-2'] }),
        bedrockClient: async () => {
          callCount++;
          if (callCount <= 4) {
            const err = new Error('throttled');
            err.code = 'ThrottlingException';
            throw err;
          }
          return { ok: true };
        },
      })
    );

    assert.equal(result.failed, 1);
    assert.equal(result.processed, 1);
  });

  it('returns zero counts when no sessions ready', async () => {
    const result = await pollOnce(
      baseDeps({ s3Client: mockS3({ sessions: [] }) })
    );

    assert.equal(result.processed, 0);
    assert.equal(result.failed, 0);
  });
});
