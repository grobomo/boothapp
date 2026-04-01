'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

// Mock S3Cache before requiring review module
class MockS3Cache {
  constructor() {
    this.store = {
      'sessions/TEST-001/metadata.json': {
        session_id: 'TEST-001', visitor_name: 'Alice Test', status: 'analyzed',
        started_at: '2026-03-31T10:00:00Z', ended_at: '2026-03-31T10:15:00Z'
      },
      'sessions/TEST-001/output/summary.json': {
        session_id: 'TEST-001', session_score: 82, executive_summary: 'Great demo session.',
        products_demonstrated: ['Vision One', 'XDR'], key_interests: ['endpoint security'],
        follow_up_actions: [{ action: 'Send trial', priority: 'high' }]
      },
      'sessions/TEST-002/metadata.json': {
        session_id: 'TEST-002', visitor_name: 'Bob Test', status: 'active',
        started_at: '2026-03-31T11:00:00Z'
      }
    };
  }
  async listSessions() {
    return ['TEST-001', 'TEST-002'].map(id => this.store[`sessions/${id}/metadata.json`]);
  }
  async _getCachedJson(key) { return this.store[key] || null; }
  stats() { return { entries: 2 }; }
}

const s3CacheMod = require('../../infra/s3-cache');
s3CacheMod.S3Cache = function() { return new MockS3Cache(); };

const { createRouter } = require('../lib/review');

function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const opts = { hostname: '127.0.0.1', port: addr.port, path, method, headers: {} };
    if (body) {
      const data = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(opts, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch (e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Review API', () => {
  let server;

  before((_, done) => {
    const app = express();
    app.use(createRouter({ bucket: 'test-bucket' }));
    server = app.listen(0, done);
  });

  after((_, done) => { server.close(done); });

  // -- Route existence --

  it('exports createRouter function', () => {
    assert.equal(typeof createRouter, 'function');
  });

  // -- GET /api/sessions/:id/review --

  it('returns default pending review for new session', async () => {
    const res = await request(server, 'GET', '/api/sessions/TEST-001/review');
    assert.equal(res.status, 200);
    assert.equal(res.body.session_id, 'TEST-001');
    assert.equal(res.body.review.status, 'pending');
    assert.equal(res.body.has_summary, true);
    assert.ok(res.body.summary);
    assert.equal(res.body.summary.session_score, 82);
  });

  it('returns has_summary=false for session without analysis', async () => {
    const res = await request(server, 'GET', '/api/sessions/TEST-002/review');
    assert.equal(res.status, 200);
    assert.equal(res.body.has_summary, false);
  });

  it('rejects invalid session ID', async () => {
    const res = await request(server, 'GET', '/api/sessions/bad%20id!/review');
    assert.equal(res.status, 400);
  });

  // -- POST /api/sessions/:id/review --

  it('approves a session', async () => {
    const res = await request(server, 'POST', '/api/sessions/TEST-001/review', {
      status: 'approved', reviewer: 'tester', notes: 'Looks good'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.review.status, 'approved');
    assert.equal(res.body.review.reviewer, 'tester');
    assert.ok(res.body.review.reviewed_at);
  });

  it('persists review status across GET', async () => {
    const res = await request(server, 'GET', '/api/sessions/TEST-001/review');
    assert.equal(res.status, 200);
    assert.equal(res.body.review.status, 'approved');
  });

  it('rejects invalid status', async () => {
    const res = await request(server, 'POST', '/api/sessions/TEST-001/review', {
      status: 'invalid_status'
    });
    assert.equal(res.status, 400);
  });

  it('accepts needs_edit status', async () => {
    const res = await request(server, 'POST', '/api/sessions/TEST-001/review', {
      status: 'needs_edit', notes: 'Fix the summary wording'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.review.status, 'needs_edit');
  });

  // -- GET /api/review/queue --

  it('returns review queue with analyzed sessions', async () => {
    const res = await request(server, 'GET', '/api/review/queue');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.queue));
    // TEST-001 is analyzed with summary, TEST-002 is active (excluded)
    const ids = res.body.queue.map(q => q.session_id);
    assert.ok(ids.includes('TEST-001'));
    assert.ok(!ids.includes('TEST-002'));
  });

  it('queue reflects updated review status', async () => {
    const res = await request(server, 'GET', '/api/review/queue');
    const item = res.body.queue.find(q => q.session_id === 'TEST-001');
    assert.ok(item);
    assert.equal(item.review_status, 'needs_edit');
  });
});
