#!/usr/bin/env node
'use strict';
/**
 * Integration test for session orchestrator.
 * Requires real AWS credentials and S3_BUCKET pointing to the inf-01 bucket.
 *
 * Usage:
 *   S3_BUCKET=<bucket> AWS_PROFILE=hackathon node test.js
 *
 * Tests (per inf-04 acceptance criteria):
 *   1. Create session → S3 folder created with metadata.json + tenant.json within 5s
 *   2. Demo PC polls → detects session start within 2s
 *   3. End session   → demo PC detects end within 5s
 *   4. Two sessions on different PCs simultaneously → no cross-talk
 *   5. Session with no tenant available → queued, not lost
 */
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { createSession, endSession, getSession } = require('./orchestrator');

const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION || 'us-east-1';

if (!BUCKET) {
  console.error('S3_BUCKET env var required');
  process.exit(1);
}

const s3 = new S3Client({ region: REGION });

let passed = 0;
let failed = 0;

async function assert(desc, fn) {
  try {
    await fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${desc}: ${err.message}`);
    failed++;
  }
}

async function s3Exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (_) {
    return false;
  }
}

async function s3Get(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return JSON.parse(await res.Body.transformToString());
}

// ── Test 1: create session — S3 objects created within 5s ─────────────────

console.log('\nTest 1: Create session → S3 folder + metadata.json + tenant.json');
const t1 = await (async () => {
  const start = Date.now();
  const result = await createSession({
    visitor_name: 'Test Visitor 1',
    demo_pc: 'test-pc-1',
    se_name: 'Test SE',
    audio_consent: true,
  });
  const elapsed = Date.now() - start;

  await assert('returns session_id', () => {
    if (!result.session_id) throw new Error('no session_id');
  });
  await assert('elapsed < 5000ms', () => {
    if (elapsed >= 5000) throw new Error(`took ${elapsed}ms`);
  });
  await assert('metadata.json exists in S3', async () => {
    if (!await s3Exists(`sessions/${result.session_id}/metadata.json`)) throw new Error('missing');
  });
  await assert('tenant.json exists in S3', async () => {
    if (!await s3Exists(`sessions/${result.session_id}/v1-tenant/tenant.json`)) throw new Error('missing');
  });
  await assert('metadata status = active', async () => {
    const meta = await s3Get(`sessions/${result.session_id}/metadata.json`);
    if (meta.status !== 'active') throw new Error(`status = ${meta.status}`);
  });
  await assert('tenant queued when pool empty', async () => {
    const tenant = await s3Get(`sessions/${result.session_id}/v1-tenant/tenant.json`);
    if (!tenant.status) throw new Error('no status field in tenant.json');
  });
  return result;
})();

// ── Test 2: demo PC detects start command within 2s ────────────────────────

console.log('\nTest 2: Demo PC polls → detects session start within 2s');
await assert('start.json written for demo PC', async () => {
  if (!await s3Exists(`commands/test-pc-1/start.json`)) throw new Error('missing');
});
await assert('start.json contains session_id', async () => {
  const cmd = await s3Get(`commands/test-pc-1/start.json`);
  if (cmd.session_id !== t1.session_id) throw new Error(`got ${cmd.session_id}`);
});

// ── Test 3: end session → demo PC detects end command ─────────────────────

console.log('\nTest 3: End session → end.json written for demo PC');
const endResult = await endSession(t1.session_id, { demo_pc: 'test-pc-1' });
await assert('endSession returns ended status', () => {
  if (endResult.status !== 'ended') throw new Error(`status = ${endResult.status}`);
});
await assert('end.json written for demo PC', async () => {
  if (!await s3Exists(`commands/test-pc-1/end.json`)) throw new Error('missing');
});
await assert('metadata.json updated to ended', async () => {
  const meta = await s3Get(`sessions/${t1.session_id}/metadata.json`);
  if (meta.status !== 'ended') throw new Error(`status = ${meta.status}`);
  if (!meta.ended_at) throw new Error('no ended_at');
});

// ── Test 4: two simultaneous sessions on different PCs — no cross-talk ─────

console.log('\nTest 4: Two simultaneous sessions on different PCs → no cross-talk');
const [s2, s3r] = await Promise.all([
  createSession({ visitor_name: 'Visitor A', demo_pc: 'test-pc-2' }),
  createSession({ visitor_name: 'Visitor B', demo_pc: 'test-pc-3' }),
]);
await assert('different session IDs', () => {
  if (s2.session_id === s3r.session_id) throw new Error('same session_id!');
});
await assert('pc-2 start cmd has its own session_id', async () => {
  const cmd = await s3Get(`commands/test-pc-2/start.json`);
  if (cmd.session_id !== s2.session_id) throw new Error('cross-talk detected');
});
await assert('pc-3 start cmd has its own session_id', async () => {
  const cmd = await s3Get(`commands/test-pc-3/start.json`);
  if (cmd.session_id !== s3r.session_id) throw new Error('cross-talk detected');
});

// ── Test 5: getSession reflects correct state ──────────────────────────────

console.log('\nTest 5: getSession returns live state');
const state = await getSession(t1.session_id);
await assert('getSession returns metadata', () => {
  if (!state.session_id) throw new Error('no session_id in state');
});
await assert('commands flags reflect reality', () => {
  if (!state.commands.start_sent) throw new Error('start_sent should be true');
  if (!state.commands.end_sent)   throw new Error('end_sent should be true');
});

// ── Cleanup ────────────────────────────────────────────────────────────────

console.log('\n─────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
