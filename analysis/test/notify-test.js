#!/usr/bin/env node
// notify-test.js — Dry-run notification test (no S3 required)
//
// Usage:
//   node analysis/test/notify-test.js
//   WEBHOOK_URL=https://hooks.slack.com/... node analysis/test/notify-test.js
//
// Tests the notification module with sample data, skipping S3 writes.

'use strict';

const { sendNotification, buildNotification } = require('../lib/notify');

const sampleMetadata = {
  session_id: 'TEST-001',
  visitor_name: 'Priya Sharma',
  company: 'Acme Corp',
  started_at: '2026-08-06T10:15:00Z',
  ended_at: '2026-08-06T10:32:00Z',
  se_name: 'Casey Mondoux',
  status: 'completed',
};

const sampleSummary = {
  session_id: 'TEST-001',
  visitor_name: 'Priya Sharma',
  demo_duration_minutes: 17,
  products_shown: ['XDR', 'Endpoint Security'],
  visitor_interests: [
    { topic: 'XDR correlation', confidence: 'high', evidence: 'asked 3 questions about it' },
  ],
  recommended_follow_up: [
    'Schedule deep-dive on XDR workbench',
    'Share XDR integration guide PDF',
  ],
};

const sampleFollowUp = {
  session_id: 'TEST-001',
  priority: 'high',
  sdr_notes: 'Priya is a SOC manager at Acme Corp evaluating XDR solutions. Strong interest in XDR correlation and endpoint integration. Currently using a competitor product. Wants to see a PoC within 2 weeks.',
  tags: ['xdr', 'endpoint'],
};

async function runTest() {
  console.log('=== Notification Module Test (dry run) ===\n');

  // Test 1: buildNotification
  console.log('--- Test 1: buildNotification ---');
  const notification = buildNotification({
    sessionId: 'TEST-001',
    bucket: 'test-bucket',
    metadata: sampleMetadata,
    summary: sampleSummary,
    followUp: sampleFollowUp,
  });

  const requiredFields = ['session_id', 'visitor_name', 'company', 'score', 'executive_summary', 'completed_at', 'report_url'];
  const missing = requiredFields.filter((f) => !(f in notification));
  if (missing.length > 0) {
    console.error(`FAIL: Missing fields: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('PASS: All required fields present');
  console.log(`  session_id: ${notification.session_id}`);
  console.log(`  visitor_name: ${notification.visitor_name}`);
  console.log(`  company: ${notification.company}`);
  console.log(`  score: ${notification.score}`);
  console.log(`  report_url: ${notification.report_url}`);
  console.log('');

  // Test 2: sendNotification (dry run)
  console.log('--- Test 2: sendNotification (dry run) ---');
  const result = await sendNotification({
    sessionId: 'TEST-001',
    bucket: 'test-bucket',
    metadata: sampleMetadata,
    summary: sampleSummary,
    followUp: sampleFollowUp,
    dryRun: true,
  });

  if (result.session_id !== 'TEST-001') {
    console.error('FAIL: Returned notification has wrong session_id');
    process.exit(1);
  }
  console.log('PASS: Dry-run notification completed');

  // Test 3: score mapping
  console.log('\n--- Test 3: Score mapping ---');
  for (const [priority, expected] of [['high', 'high'], ['medium', 'medium'], ['low', 'low']]) {
    const n = buildNotification({
      sessionId: 'TEST-SCORE',
      bucket: 'b',
      metadata: {},
      summary: {},
      followUp: { priority },
    });
    if (n.score !== expected) {
      console.error(`FAIL: priority=${priority} -> score=${n.score}, expected ${expected}`);
      process.exit(1);
    }
  }
  console.log('PASS: All priority->score mappings correct');

  console.log('\n=== All tests passed ===');
}

runTest().catch((err) => {
  console.error(`Test FATAL: ${err.message}`);
  process.exit(1);
});
