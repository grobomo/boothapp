'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Test the review API routes
describe('Review API', () => {
  let createRouter;

  before(() => {
    createRouter = require('../lib/review').createRouter;
  });

  it('exports createRouter function', () => {
    assert.equal(typeof createRouter, 'function');
  });

  it('createRouter returns an express router', () => {
    // Mock opts — S3 calls will fail but routes should register
    const router = createRouter({ bucket: 'test-bucket' });
    assert.ok(router);
    assert.equal(typeof router, 'function');
  });

  it('router has GET /api/sessions/:id/review route', () => {
    const router = createRouter({ bucket: 'test-bucket' });
    const routes = router.stack
      .filter(layer => layer.route)
      .map(layer => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

    const reviewGet = routes.find(r => r.path === '/api/sessions/:id/review' && r.methods.includes('get'));
    assert.ok(reviewGet, 'GET /api/sessions/:id/review should exist');
  });

  it('router has POST /api/sessions/:id/review route', () => {
    const router = createRouter({ bucket: 'test-bucket' });
    const routes = router.stack
      .filter(layer => layer.route)
      .map(layer => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

    const reviewPost = routes.find(r => r.path === '/api/sessions/:id/review' && r.methods.includes('post'));
    assert.ok(reviewPost, 'POST /api/sessions/:id/review should exist');
  });

  it('router has GET /api/review/queue route', () => {
    const router = createRouter({ bucket: 'test-bucket' });
    const routes = router.stack
      .filter(layer => layer.route)
      .map(layer => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

    const queue = routes.find(r => r.path === '/api/review/queue' && r.methods.includes('get'));
    assert.ok(queue, 'GET /api/review/queue should exist');
  });
});
