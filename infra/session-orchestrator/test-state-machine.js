#!/usr/bin/env node
'use strict';
/**
 * Unit tests for session lifecycle state machine.
 * No AWS credentials needed — mocks S3 operations in-memory.
 *
 * Usage: node test-state-machine.js
 */

// ── In-memory S3 mock ──────────────────────────────────────────────────────

const store = {};

require('./s3');  // force load so we can override
const s3 = require('./s3');

// Replace exports with in-memory implementations
s3.putObject = async (key, body) => {
  store[key] = typeof body === 'string' ? body : JSON.stringify(body);
};
s3.getObject = async (key) => {
  if (!(key in store)) {
    const err = new Error('NoSuchKey');
    err.name = 'NoSuchKey';
    err.$metadata = { httpStatusCode: 404 };
    throw err;
  }
  return JSON.parse(store[key]);
};
s3.objectExists = async (key) => key in store;
s3.deleteObject = async (key) => { delete store[key]; };

// Mock tenant-pool
const tp = require('./tenant-pool');
tp.claimTenant = async () => null;

const {
  createSession, endSession, getSession,
  transitionState, getSessionState,
  validateSessionId,
  VALID_STATES, TRANSITIONS,
} = require('./orchestrator');

let passed = 0;
let failed = 0;

async function test(desc, fn) {
  try {
    await fn();
    console.log(`  + ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  x ${desc}: ${err.message}`);
    failed++;
  }
}

function eq(a, b) {
  if (a !== b) throw new Error(`expected '${b}', got '${a}'`);
}

// ── Tests ──────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n=== State Machine Definition ===');

  await test('VALID_STATES has 7 states', () => {
    eq(VALID_STATES.length, 7);
  });

  await test('all states have transition entries', () => {
    for (const s of VALID_STATES) {
      if (!(s in TRANSITIONS)) throw new Error(`missing transitions for '${s}'`);
    }
  });

  await test('sent is terminal (no outbound transitions)', () => {
    eq(TRANSITIONS.sent.length, 0);
  });

  // ── Create session ─────────────────────────────────────────────────────

  console.log('\n=== Session Creation ===');

  const { session_id } = await createSession({
    visitor_name: 'Test User',
    demo_pc: 'pc-1',
  });

  await test('session created with active status', async () => {
    const s = await getSession(session_id);
    eq(s.status, 'active');
  });

  await test('state.json initialized on creation', async () => {
    const state = await getSessionState(session_id);
    eq(state.current_state, 'active');
    eq(state.history.length, 1);
    eq(state.history[0].to, 'active');
  });

  // ── Valid transitions: active -> recording -> ended -> processing -> analyzed -> reviewed -> sent

  console.log('\n=== Happy Path Transitions ===');

  await test('active -> recording', async () => {
    const r = await transitionState(session_id, 'recording', { source: 'demo-pc' });
    eq(r.previous_state, 'active');
    eq(r.state, 'recording');
  });

  await test('recording -> ended', async () => {
    const r = await transitionState(session_id, 'ended');
    eq(r.previous_state, 'recording');
    eq(r.state, 'ended');
  });

  await test('ended -> processing', async () => {
    const r = await transitionState(session_id, 'processing');
    eq(r.state, 'processing');
  });

  await test('processing -> analyzed', async () => {
    const r = await transitionState(session_id, 'analyzed');
    eq(r.state, 'analyzed');
  });

  await test('analyzed -> reviewed', async () => {
    const r = await transitionState(session_id, 'reviewed');
    eq(r.state, 'reviewed');
  });

  await test('reviewed -> sent', async () => {
    const r = await transitionState(session_id, 'sent');
    eq(r.state, 'sent');
  });

  await test('state.json has full history (7 entries)', async () => {
    const state = await getSessionState(session_id);
    eq(state.current_state, 'sent');
    eq(state.history.length, 7); // null->active + 6 transitions
  });

  await test('metadata.json status synced to sent', async () => {
    const s = await getSession(session_id);
    eq(s.status, 'sent');
  });

  // ── Invalid transitions ──────────────────────────────────────────────

  console.log('\n=== Invalid Transitions ===');

  await test('sent -> active rejected (terminal state)', async () => {
    try {
      await transitionState(session_id, 'active');
      throw new Error('should have thrown');
    } catch (err) {
      eq(err.statusCode, 409);
    }
  });

  // Create a fresh session for more invalid-transition tests
  const { session_id: sid2 } = await createSession({
    visitor_name: 'Test 2',
    demo_pc: 'pc-2',
  });

  await test('active -> processing rejected (must go through ended first)', async () => {
    try {
      await transitionState(sid2, 'processing');
      throw new Error('should have thrown');
    } catch (err) {
      eq(err.statusCode, 409);
    }
  });

  await test('active -> analyzed rejected', async () => {
    try {
      await transitionState(sid2, 'analyzed');
      throw new Error('should have thrown');
    } catch (err) {
      eq(err.statusCode, 409);
    }
  });

  await test('invalid state name rejected', async () => {
    try {
      await transitionState(sid2, 'bogus');
      throw new Error('should have thrown');
    } catch (err) {
      eq(err.statusCode, 400);
    }
  });

  // ── Skip recording (active -> ended directly) ──────────────────────

  console.log('\n=== Skip Recording Path ===');

  await test('active -> ended allowed (skip recording)', async () => {
    const r = await transitionState(sid2, 'ended');
    eq(r.previous_state, 'active');
    eq(r.state, 'ended');
  });

  // ── endSession also writes state.json ─────────────────────────────

  console.log('\n=== endSession Integration ===');

  const { session_id: sid3 } = await createSession({
    visitor_name: 'Test 3',
    demo_pc: 'pc-3',
  });

  await endSession(sid3, { demo_pc: 'pc-3' });

  await test('endSession writes state.json with ended transition', async () => {
    const state = await getSessionState(sid3);
    eq(state.current_state, 'ended');
    const last = state.history[state.history.length - 1];
    eq(last.from, 'active');
    eq(last.to, 'ended');
  });

  // ── Context stored in transitions ──────────────────────────────────

  console.log('\n=== Context in Transitions ===');

  await test('context stored when provided', async () => {
    const state = await getSessionState(session_id);
    const recordingTransition = state.history.find(h => h.to === 'recording');
    eq(recordingTransition.context.source, 'demo-pc');
  });

  await test('context omitted when empty', async () => {
    const state = await getSessionState(session_id);
    const endedTransition = state.history.find(h => h.to === 'ended');
    eq(endedTransition.context, undefined);
  });

  // ── Session ID Validation ────────────────────────────────────────────

  console.log('\n=== Session ID Validation ===');

  await test('validateSessionId accepts valid uppercase alphanumeric', () => {
    validateSessionId('ABC123');
  });

  await test('validateSessionId rejects empty string', async () => {
    try { validateSessionId(''); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  await test('validateSessionId rejects null', async () => {
    try { validateSessionId(null); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  await test('validateSessionId rejects undefined', async () => {
    try { validateSessionId(undefined); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  await test('validateSessionId rejects lowercase', async () => {
    try { validateSessionId('abc123'); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  await test('validateSessionId rejects special characters', async () => {
    try { validateSessionId('AB-12'); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  await test('validateSessionId rejects path traversal', async () => {
    try { validateSessionId('../etc/passwd'); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  await test('validateSessionId rejects string > 20 chars', async () => {
    try { validateSessionId('A'.repeat(21)); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  await test('validateSessionId accepts 20-char string', () => {
    validateSessionId('A'.repeat(20));
  });

  await test('getSession rejects invalid session_id before S3 call', async () => {
    try { await getSession('bad!id'); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  await test('endSession rejects invalid session_id', async () => {
    try { await endSession(''); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  await test('transitionState rejects invalid session_id', async () => {
    try { await transitionState('../hack', 'ended'); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  await test('getSessionState rejects invalid session_id', async () => {
    try { await getSessionState(null); throw new Error('should have thrown'); }
    catch (err) { eq(err.statusCode, 400); }
  });

  // ── Results ─────────────────────────────────────────────────────────

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
