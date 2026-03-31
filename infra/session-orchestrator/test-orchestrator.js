#!/usr/bin/env node
'use strict';
/**
 * End-to-end orchestrator test.
 *
 * Exercises the full Lambda lifecycle against real S3:
 *   1. createSession  -> metadata.json exists, commands/start.json written
 *   2. endSession     -> commands/end.json written, metadata status = ended
 *
 * Usage:
 *   S3_BUCKET=boothapp-sessions-752266476357 AWS_PROFILE=hackathon node test-orchestrator.js
 *
 * Exit 0 on all pass, non-zero on any failure.
 */
var { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
var { createSession, endSession } = require('./orchestrator');

var BUCKET = process.env.S3_BUCKET;
var REGION = process.env.AWS_REGION || 'us-east-1';
var DEMO_PC = 'e2e-test-pc-' + Date.now();

if (!BUCKET) {
  console.error('ERROR: S3_BUCKET env var required');
  process.exit(1);
}

var s3 = new S3Client({ region: REGION });
var passed = 0;
var failed = 0;

async function check(desc, fn) {
  try {
    await fn();
    console.log('  [PASS] ' + desc);
    passed++;
  } catch (err) {
    console.error('  [FAIL] ' + desc + ': ' + err.message);
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
  var res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return JSON.parse(await res.Body.transformToString());
}

(async function main() {
  console.log('\n=== Session Orchestrator E2E Test ===');
  console.log('Bucket: ' + BUCKET);
  console.log('Demo PC: ' + DEMO_PC);

  // ── Step 1: createSession ─────────────────────────────────────────────────

  console.log('\n-- createSession --');
  var result = await createSession({
    visitor_name: 'E2E Test Visitor',
    demo_pc: DEMO_PC,
    se_name: 'E2E Tester',
    audio_consent: true,
  });
  var sid = result.session_id;
  console.log('  session_id: ' + sid);

  await check('createSession returns session_id', function() {
    if (!sid) throw new Error('missing session_id');
  });

  await check('metadata.json exists in S3', async function() {
    if (!await s3Exists('sessions/' + sid + '/metadata.json'))
      throw new Error('sessions/' + sid + '/metadata.json not found');
  });

  await check('metadata.json status = active', async function() {
    var meta = await s3Get('sessions/' + sid + '/metadata.json');
    if (meta.status !== 'active')
      throw new Error('expected active, got ' + meta.status);
  });

  await check('commands/start.json written for demo PC', async function() {
    if (!await s3Exists('commands/' + DEMO_PC + '/start.json'))
      throw new Error('commands/' + DEMO_PC + '/start.json not found');
  });

  await check('start.json references correct session_id', async function() {
    var cmd = await s3Get('commands/' + DEMO_PC + '/start.json');
    if (cmd.session_id !== sid)
      throw new Error('expected ' + sid + ', got ' + cmd.session_id);
  });

  // ── Step 2: endSession ────────────────────────────────────────────────────

  console.log('\n-- endSession --');
  var endResult = await endSession(sid, { demo_pc: DEMO_PC });

  await check('endSession returns status ended', function() {
    if (endResult.status !== 'ended')
      throw new Error('expected ended, got ' + endResult.status);
  });

  await check('commands/end.json written for demo PC', async function() {
    if (!await s3Exists('commands/' + DEMO_PC + '/end.json'))
      throw new Error('commands/' + DEMO_PC + '/end.json not found');
  });

  await check('end.json references correct session_id', async function() {
    var cmd = await s3Get('commands/' + DEMO_PC + '/end.json');
    if (cmd.session_id !== sid)
      throw new Error('expected ' + sid + ', got ' + cmd.session_id);
  });

  await check('metadata.json status = ended after endSession', async function() {
    var meta = await s3Get('sessions/' + sid + '/metadata.json');
    if (meta.status !== 'ended')
      throw new Error('expected ended, got ' + meta.status);
  });

  await check('metadata.json has ended_at timestamp', async function() {
    var meta = await s3Get('sessions/' + sid + '/metadata.json');
    if (!meta.ended_at)
      throw new Error('ended_at is null/missing');
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n---------------------------------');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
