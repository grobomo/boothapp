'use strict';

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// We need to mock the S3Client used by s3.js. Since s3.js resolves
// @aws-sdk/client-s3 from analysis/node_modules, we patch the module
// at that path in require.cache.

// First, find the actual resolution path s3.js would use
const s3HelpersPath = path.resolve(__dirname, '../../analysis/lib/s3.js');

// Resolve @aws-sdk/client-s3 from the same directory as s3.js
const awsSdkPath = require.resolve('@aws-sdk/client-s3', {
  paths: [path.dirname(s3HelpersPath)],
});

// Resolve s3-encryption from s3.js perspective
const encPath = require.resolve('../../infra/lib/s3-encryption', {
  paths: [path.dirname(s3HelpersPath)],
});

// --- Mock state ---
let sendCalls = [];
let sendHandler = null;

// --- Mock classes ---
class MockS3Client {
  constructor() {}
  async send(cmd) {
    sendCalls.push(cmd);
    if (sendHandler) return sendHandler(cmd);
    return {};
  }
}

function makeCmdClass(name) {
  return class {
    constructor(params) {
      Object.assign(this, params);
      this._cmdName = name;
    }
  };
}

const MockListObjectsV2Command = makeCmdClass('ListObjectsV2');
const MockHeadObjectCommand = makeCmdClass('HeadObject');
const MockGetObjectCommand = makeCmdClass('GetObject');
const MockPutObjectCommand = makeCmdClass('PutObject');

// Patch the AWS SDK module in cache
require.cache[awsSdkPath] = {
  id: awsSdkPath,
  filename: awsSdkPath,
  loaded: true,
  exports: {
    S3Client: MockS3Client,
    ListObjectsV2Command: MockListObjectsV2Command,
    HeadObjectCommand: MockHeadObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    PutObjectCommand: MockPutObjectCommand,
  },
};

// Patch s3-encryption
require.cache[encPath] = {
  id: encPath,
  filename: encPath,
  loaded: true,
  exports: {
    SSE_PARAMS: { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: 'alias/test-key' },
    withEncryption: (p) => Object.assign({}, p, { ServerSideEncryption: 'aws:kms' }),
    KMS_KEY_ALIAS: 'alias/test-key',
  },
};

// Clear s3.js from cache so it picks up mocks
delete require.cache[s3HelpersPath];

const s3Helpers = require(s3HelpersPath);

// --- Helper to create an async iterable stream from string ---
function stringStream(str) {
  return {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(str);
    },
  };
}

// --- Tests ---

beforeEach(() => {
  sendCalls = [];
  sendHandler = null;
});

describe('listSessions', () => {
  it('extracts session IDs from CommonPrefixes', async () => {
    sendHandler = () => ({
      CommonPrefixes: [
        { Prefix: 'sessions/ABC123/' },
        { Prefix: 'sessions/DEF456/' },
      ],
      IsTruncated: false,
    });

    const sessions = await s3Helpers.listSessions('test-bucket');
    assert.deepStrictEqual(sessions, ['ABC123', 'DEF456']);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].Bucket, 'test-bucket');
    assert.equal(sendCalls[0].Prefix, 'sessions/');
    assert.equal(sendCalls[0].Delimiter, '/');
  });

  it('handles pagination with ContinuationToken', async () => {
    let callCount = 0;
    sendHandler = () => {
      callCount++;
      if (callCount === 1) {
        return {
          CommonPrefixes: [{ Prefix: 'sessions/FIRST/' }],
          IsTruncated: true,
          NextContinuationToken: 'token-abc',
        };
      }
      return {
        CommonPrefixes: [{ Prefix: 'sessions/SECOND/' }],
        IsTruncated: false,
      };
    };

    const sessions = await s3Helpers.listSessions('test-bucket');
    assert.deepStrictEqual(sessions, ['FIRST', 'SECOND']);
    assert.equal(callCount, 2);
    assert.equal(sendCalls[1].ContinuationToken, 'token-abc');
  });

  it('returns empty array when no sessions', async () => {
    sendHandler = () => ({ CommonPrefixes: [], IsTruncated: false });
    const sessions = await s3Helpers.listSessions('test-bucket');
    assert.deepStrictEqual(sessions, []);
  });
});

describe('getJson', () => {
  it('fetches and parses JSON from S3', async () => {
    const data = { session_id: 'TEST', status: 'ended' };
    sendHandler = (cmd) => {
      assert.equal(cmd._cmdName, 'GetObject');
      assert.equal(cmd.Key, 'sessions/TEST/metadata.json');
      return { Body: stringStream(JSON.stringify(data)) };
    };

    const result = await s3Helpers.getJson('test-bucket', 'sessions/TEST/metadata.json');
    assert.deepStrictEqual(result, data);
  });

  it('throws on invalid JSON', async () => {
    sendHandler = () => ({ Body: stringStream('not json') });
    await assert.rejects(
      () => s3Helpers.getJson('test-bucket', 'some-key'),
      { name: 'SyntaxError' }
    );
  });
});

describe('isAlreadyClaimed', () => {
  it('returns true when marker exists', async () => {
    sendHandler = (cmd) => {
      assert.equal(cmd._cmdName, 'HeadObject');
      assert.equal(cmd.Key, 'sessions/S1/output/.analysis-claimed');
      return {};
    };

    const result = await s3Helpers.isAlreadyClaimed('bucket', 'S1');
    assert.equal(result, true);
  });

  it('returns false when marker does not exist', async () => {
    sendHandler = () => {
      const err = new Error('NotFound');
      err.name = 'NotFound';
      throw err;
    };

    const result = await s3Helpers.isAlreadyClaimed('bucket', 'S1');
    assert.equal(result, false);
  });
});

describe('writeMarker', () => {
  it('writes JSON marker with SSE params', async () => {
    sendHandler = (cmd) => {
      assert.equal(cmd._cmdName, 'PutObject');
      assert.equal(cmd.Key, 'sessions/S1/output/.analysis-claimed');
      assert.equal(cmd.ContentType, 'application/json');
      assert.equal(cmd.ServerSideEncryption, 'aws:kms');
      const body = JSON.parse(cmd.Body);
      assert.equal(body.claimed, true);
      return {};
    };

    await s3Helpers.writeMarker('bucket', 'S1', { claimed: true });
    assert.equal(sendCalls.length, 1);
  });
});

describe('isSessionComplete', () => {
  it('returns true when metadata ended + clicks + transcript exist', async () => {
    sendHandler = (cmd) => {
      if (cmd._cmdName === 'GetObject') {
        return { Body: stringStream(JSON.stringify({ status: 'ended' })) };
      }
      // HeadObject -- all files exist
      return {};
    };

    const result = await s3Helpers.isSessionComplete('bucket', 'S1');
    assert.equal(result, true);
  });

  it('returns false when metadata status is active', async () => {
    sendHandler = (cmd) => {
      if (cmd._cmdName === 'GetObject') {
        return { Body: stringStream(JSON.stringify({ status: 'active' })) };
      }
      return {};
    };

    const result = await s3Helpers.isSessionComplete('bucket', 'S1');
    assert.equal(result, false);
  });

  it('returns false when metadata.json is missing', async () => {
    sendHandler = (cmd) => {
      if (cmd._cmdName === 'GetObject') {
        const err = new Error('NoSuchKey');
        err.name = 'NoSuchKey';
        throw err;
      }
      return {};
    };

    const result = await s3Helpers.isSessionComplete('bucket', 'S1');
    assert.equal(result, false);
  });

  it('returns { needsTranscription: true } when audio exists but no transcript', async () => {
    sendHandler = (cmd) => {
      if (cmd._cmdName === 'GetObject') {
        return { Body: stringStream(JSON.stringify({ status: 'ended' })) };
      }
      if (cmd._cmdName === 'HeadObject') {
        if (cmd.Key.includes('transcript')) {
          const err = new Error('NotFound');
          err.name = 'NotFound';
          throw err;
        }
        return {};
      }
      return {};
    };

    const result = await s3Helpers.isSessionComplete('bucket', 'S1');
    assert.deepStrictEqual(result, { needsTranscription: true });
  });
});

describe('listObjects', () => {
  it('returns array of objects under prefix', async () => {
    const now = new Date();
    sendHandler = () => ({
      Contents: [
        { Key: 'sessions/S1/file1.json', LastModified: now, Size: 100 },
        { Key: 'sessions/S1/file2.json', LastModified: now, Size: 200 },
      ],
      IsTruncated: false,
    });

    const result = await s3Helpers.listObjects('bucket', 'sessions/S1/');
    assert.equal(result.length, 2);
    assert.equal(result[0].Key, 'sessions/S1/file1.json');
    assert.equal(result[1].Size, 200);
  });
});

describe('updateMetadata', () => {
  it('merges updates into existing metadata and writes back', async () => {
    let writtenBody = null;
    sendHandler = (cmd) => {
      if (cmd._cmdName === 'GetObject') {
        return { Body: stringStream(JSON.stringify({ session_id: 'S1', status: 'active' })) };
      }
      if (cmd._cmdName === 'PutObject') {
        writtenBody = JSON.parse(cmd.Body);
        return {};
      }
      return {};
    };

    await s3Helpers.updateMetadata('bucket', 'S1', { status: 'ended', ended_at: '2026-01-01T00:00:00Z' });
    assert.equal(writtenBody.session_id, 'S1');
    assert.equal(writtenBody.status, 'ended');
    assert.equal(writtenBody.ended_at, '2026-01-01T00:00:00Z');
  });

  it('creates metadata when none exists', async () => {
    let writtenBody = null;
    sendHandler = (cmd) => {
      if (cmd._cmdName === 'GetObject') {
        const err = new Error('NoSuchKey');
        err.name = 'NoSuchKey';
        throw err;
      }
      if (cmd._cmdName === 'PutObject') {
        writtenBody = JSON.parse(cmd.Body);
        return {};
      }
      return {};
    };

    await s3Helpers.updateMetadata('bucket', 'S1', { status: 'new' });
    assert.deepStrictEqual(writtenBody, { status: 'new' });
  });
});
