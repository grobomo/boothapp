'use strict';

// Test for screenshots API route
// Mocks @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner

const http = require('http');
const express = require('express');
const Module = require('module');

// --- Mock AWS SDK modules before requiring screenshots ---

const mockScreenshots = [
  { Key: 'sessions/TEST1/screenshots/click-001.jpg', Size: 45000, LastModified: new Date() },
  { Key: 'sessions/TEST1/screenshots/click-002.jpg', Size: 52000, LastModified: new Date() },
  { Key: 'sessions/TEST1/screenshots/periodic-001.jpg', Size: 38000, LastModified: new Date() },
];

const mockClicks = {
  session_id: 'TEST1',
  events: [
    {
      index: 1,
      timestamp: '2026-08-05T14:32:15.123Z',
      type: 'click',
      dom_path: 'div.app > nav > a',
      element: { tag: 'a', text: 'Dashboard' },
      coordinates: { x: 450, y: 120 },
      screenshot_file: 'screenshots/click-001.jpg',
    },
  ],
};

// Mock S3Client and commands
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === '@aws-sdk/client-s3') return 'mock-aws-s3';
  if (request === '@aws-sdk/s3-request-presigner') return 'mock-aws-presigner';
  return originalResolve.call(this, request, parent, ...rest);
};

require.cache['mock-aws-s3'] = {
  id: 'mock-aws-s3',
  filename: 'mock-aws-s3',
  loaded: true,
  exports: {
    S3Client: class {
      async send(cmd) {
        if (cmd._type === 'ListObjectsV2') {
          if (cmd.Prefix.includes('EMPTY')) return { Contents: [] };
          return { Contents: mockScreenshots };
        }
        if (cmd._type === 'GetObject') {
          if (cmd.Key.includes('clicks.json')) {
            return {
              Body: { transformToString: async () => JSON.stringify(mockClicks) },
            };
          }
          return { Body: Buffer.from('fake-image-data') };
        }
        throw new Error('Unknown command');
      }
    },
    ListObjectsV2Command: class {
      constructor(params) { this._type = 'ListObjectsV2'; this.Prefix = params.Prefix; }
    },
    GetObjectCommand: class {
      constructor(params) { this._type = 'GetObject'; this.Key = params.Key; }
    },
  },
};

require.cache['mock-aws-presigner'] = {
  id: 'mock-aws-presigner',
  filename: 'mock-aws-presigner',
  loaded: true,
  exports: {
    getSignedUrl: async (client, cmd, opts) => 'https://s3.example.com/signed/' + cmd.Key,
  },
};

const { createRouter } = require('../lib/screenshots');

let server;
let baseUrl;

function request(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log('  [PASS] ' + label);
    passed++;
  } else {
    console.error('  [FAIL] ' + label);
    failed++;
  }
}

async function runTests() {
  const app = express();
  app.use(createRouter({ bucket: 'test-bucket' }));
  server = app.listen(0);
  const addr = server.address();
  baseUrl = 'http://127.0.0.1:' + addr.port;

  console.log('--- GET /api/session/:id/screenshots ---');

  // Valid session with screenshots
  let res = await request('GET', '/api/session/TEST1/screenshots');
  assert('returns 200', res.status === 200);
  assert('has session_id', res.body.session_id === 'TEST1');
  assert('returns 3 screenshots', res.body.screenshots.length === 3);
  assert('screenshots have url', res.body.screenshots[0].url.includes('signed'));
  assert('screenshots have filename', res.body.screenshots[0].filename === 'click-001.jpg');
  assert('screenshots have size', typeof res.body.screenshots[0].size === 'number');
  assert('returns click events', res.body.clicks.length === 1);
  assert('click has coordinates', res.body.clicks[0].coordinates.x === 450);

  console.log('\n--- GET /api/session/:id/screenshots (empty session) ---');

  res = await request('GET', '/api/session/EMPTY/screenshots');
  assert('returns 200 for empty', res.status === 200);
  assert('empty screenshots array', res.body.screenshots.length === 0);

  console.log('\n--- GET /api/session/:id/screenshots (invalid ID) ---');

  res = await request('GET', '/api/session/bad%20id!/screenshots');
  assert('rejects invalid ID', res.status === 400);

  console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  if (server) server.close();
  process.exit(1);
});
