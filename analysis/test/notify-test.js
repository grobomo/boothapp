#!/usr/bin/env node
// notify-test.js — Dry-run notification test (no S3 required)
//
// Usage:
//   node analysis/test/notify-test.js
//   WEBHOOK_URL=https://hooks.slack.com/... node analysis/test/notify-test.js
//
// Tests the notification module with sample data, skipping S3 writes.

'use strict';

const {
  sendNotification,
  buildNotification,
  buildWebhookPayload,
  parseWebhookUrls,
} = require('../lib/notify');

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
  demo_duration_seconds: 1020,
  session_score: 8,
  products_demonstrated: ['XDR', 'Endpoint Security'],
  key_interests: [
    { topic: 'XDR correlation', confidence: 'high', evidence: 'asked 3 questions about it' },
    { topic: 'Splunk Integration', confidence: 'medium', evidence: 'asked about native app' },
  ],
  follow_up_actions: [
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

  const requiredFields = ['session_id', 'visitor_name', 'company', 'session_score', 'score', 'executive_summary', 'products_demonstrated', 'completed_at', 'report_url'];
  const missing = requiredFields.filter((f) => !(f in notification));
  if (missing.length > 0) {
    console.error(`FAIL: Missing fields: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('PASS: All required fields present');
  console.log(`  session_id: ${notification.session_id}`);
  console.log(`  visitor_name: ${notification.visitor_name}`);
  console.log(`  company: ${notification.company}`);
  console.log(`  session_score: ${notification.session_score}`);
  console.log(`  score: ${notification.score}`);
  console.log(`  products_demonstrated: ${JSON.stringify(notification.products_demonstrated)}`);
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

  // Test 4: session_score and products_demonstrated
  console.log('\n--- Test 4: Webhook payload fields ---');
  const webhookNotification = buildNotification({
    sessionId: 'TEST-WEBHOOK',
    bucket: 'b',
    metadata: { company: 'TestCo' },
    summary: { visitor_name: 'Jane Doe', session_score: 7, products_demonstrated: ['XDR', 'Cloud Security'] },
    followUp: { priority: 'high', sdr_notes: 'Strong interest in XDR.' },
  });
  if (webhookNotification.session_score !== 7) {
    console.error(`FAIL: session_score=${webhookNotification.session_score}, expected 7`);
    process.exit(1);
  }
  if (!Array.isArray(webhookNotification.products_demonstrated) || webhookNotification.products_demonstrated.length !== 2) {
    console.error(`FAIL: products_demonstrated=${JSON.stringify(webhookNotification.products_demonstrated)}, expected 2-element array`);
    process.exit(1);
  }
  if (webhookNotification.executive_summary !== 'Strong interest in XDR.') {
    console.error(`FAIL: executive_summary mismatch`);
    process.exit(1);
  }
  console.log('PASS: session_score, products_demonstrated, executive_summary correct');

  // Test 5: missing summary fields default gracefully
  console.log('\n--- Test 5: Missing summary fields ---');
  const sparseNotification = buildNotification({
    sessionId: 'TEST-SPARSE',
    bucket: 'b',
    metadata: {},
    summary: {},
    followUp: { priority: 'low' },
  });
  if (sparseNotification.session_score !== null) {
    console.error(`FAIL: session_score should be null when missing, got ${sparseNotification.session_score}`);
    process.exit(1);
  }
  if (!Array.isArray(sparseNotification.products_demonstrated) || sparseNotification.products_demonstrated.length !== 0) {
    console.error(`FAIL: products_demonstrated should be empty array when missing`);
    process.exit(1);
  }
  console.log('PASS: Missing fields default correctly (null / empty array)');

  // Test 6: parseWebhookUrls
  console.log('\n--- Test 6: parseWebhookUrls ---');
  const empty = parseWebhookUrls('');
  if (empty.length !== 0) {
    console.error(`FAIL: empty string should return [], got ${JSON.stringify(empty)}`);
    process.exit(1);
  }
  const undef = parseWebhookUrls(undefined);
  if (undef.length !== 0) {
    console.error(`FAIL: undefined should return [], got ${JSON.stringify(undef)}`);
    process.exit(1);
  }
  const single = parseWebhookUrls('https://hooks.slack.com/abc');
  if (single.length !== 1 || single[0] !== 'https://hooks.slack.com/abc') {
    console.error(`FAIL: single URL parse failed: ${JSON.stringify(single)}`);
    process.exit(1);
  }
  const multi = parseWebhookUrls('https://a.com/hook , https://b.com/hook, https://c.com/hook');
  if (multi.length !== 3) {
    console.error(`FAIL: multi URL parse expected 3, got ${multi.length}: ${JSON.stringify(multi)}`);
    process.exit(1);
  }
  if (multi[0] !== 'https://a.com/hook' || multi[1] !== 'https://b.com/hook' || multi[2] !== 'https://c.com/hook') {
    console.error(`FAIL: multi URL trimming failed: ${JSON.stringify(multi)}`);
    process.exit(1);
  }
  const withBlanks = parseWebhookUrls('https://a.com,,, https://b.com, ,');
  if (withBlanks.length !== 2) {
    console.error(`FAIL: blanks not filtered: ${JSON.stringify(withBlanks)}`);
    process.exit(1);
  }
  console.log('PASS: parseWebhookUrls handles empty, single, multi, and blank entries');

  // Test 7: buildWebhookPayload
  console.log('\n--- Test 7: buildWebhookPayload ---');
  const webhookPayload = buildWebhookPayload({
    sessionId: 'TEST-WH',
    bucket: 'b',
    metadata: { company: 'Acme Corp' },
    summary: sampleSummary,
    followUp: sampleFollowUp,
  });
  const whFields = ['session_id', 'visitor_name', 'company', 'products_demonstrated', 'key_interests', 'engagement_score', 'follow_up_priority', 'analysis_url'];
  const whMissing = whFields.filter((f) => !(f in webhookPayload));
  if (whMissing.length > 0) {
    console.error(`FAIL: Webhook payload missing fields: ${whMissing.join(', ')}`);
    process.exit(1);
  }
  if (webhookPayload.session_id !== 'TEST-WH') {
    console.error(`FAIL: session_id=${webhookPayload.session_id}, expected TEST-WH`);
    process.exit(1);
  }
  if (webhookPayload.engagement_score !== 8) {
    console.error(`FAIL: engagement_score=${webhookPayload.engagement_score}, expected 8`);
    process.exit(1);
  }
  if (webhookPayload.follow_up_priority !== 'high') {
    console.error(`FAIL: follow_up_priority=${webhookPayload.follow_up_priority}, expected high`);
    process.exit(1);
  }
  if (!webhookPayload.analysis_url.includes('TEST-WH')) {
    console.error(`FAIL: analysis_url doesn't contain session ID`);
    process.exit(1);
  }
  console.log('PASS: All webhook payload fields present and correct');
  console.log(`  Payload: ${JSON.stringify(webhookPayload, null, 2)}`);

  // Test 8: key_interests extraction (object -> string topic)
  console.log('\n--- Test 8: key_interests extraction ---');
  if (!Array.isArray(webhookPayload.key_interests) || webhookPayload.key_interests.length !== 2) {
    console.error(`FAIL: key_interests should have 2 entries, got ${JSON.stringify(webhookPayload.key_interests)}`);
    process.exit(1);
  }
  if (webhookPayload.key_interests[0] !== 'XDR correlation') {
    console.error(`FAIL: key_interests[0]=${webhookPayload.key_interests[0]}, expected 'XDR correlation'`);
    process.exit(1);
  }
  console.log('PASS: key_interests correctly extracted topic strings from objects');

  // Test 9: key_interests with plain string array
  console.log('\n--- Test 9: key_interests with string array ---');
  const stringInterests = buildWebhookPayload({
    sessionId: 'TEST-STR',
    bucket: 'b',
    metadata: {},
    summary: { key_interests: ['XDR', 'Cloud'] },
    followUp: { priority: 'medium' },
  });
  if (stringInterests.key_interests[0] !== 'XDR' || stringInterests.key_interests[1] !== 'Cloud') {
    console.error(`FAIL: string key_interests not passed through: ${JSON.stringify(stringInterests.key_interests)}`);
    process.exit(1);
  }
  console.log('PASS: Plain string key_interests passed through correctly');

  // Test 10: sparse webhook payload defaults
  console.log('\n--- Test 10: Sparse webhook payload defaults ---');
  const sparseWh = buildWebhookPayload({
    sessionId: 'TEST-SPARSE-WH',
    bucket: 'b',
    metadata: {},
    summary: {},
    followUp: {},
  });
  if (sparseWh.engagement_score !== null) {
    console.error(`FAIL: engagement_score should be null, got ${sparseWh.engagement_score}`);
    process.exit(1);
  }
  if (sparseWh.follow_up_priority !== 'medium') {
    console.error(`FAIL: follow_up_priority should default to medium, got ${sparseWh.follow_up_priority}`);
    process.exit(1);
  }
  if (!Array.isArray(sparseWh.key_interests) || sparseWh.key_interests.length !== 0) {
    console.error(`FAIL: key_interests should be empty array`);
    process.exit(1);
  }
  console.log('PASS: Sparse webhook payload defaults correctly');

  // Test 11: dry-run with WEBHOOK_URL logs but doesn't POST
  console.log('\n--- Test 11: Dry-run with WEBHOOK_URL ---');
  const origUrl = process.env.WEBHOOK_URL;
  process.env.WEBHOOK_URL = 'https://example.com/hook1,https://example.com/hook2';
  const dryResult = await sendNotification({
    sessionId: 'TEST-DRY-WH',
    bucket: 'test-bucket',
    metadata: sampleMetadata,
    summary: sampleSummary,
    followUp: sampleFollowUp,
    dryRun: true,
  });
  if (origUrl) {
    process.env.WEBHOOK_URL = origUrl;
  } else {
    delete process.env.WEBHOOK_URL;
  }
  if (!Array.isArray(dryResult.webhook_results)) {
    console.error('FAIL: webhook_results should be an array');
    process.exit(1);
  }
  if (dryResult.webhook_results.length !== 0) {
    console.error('FAIL: dry run should not deliver webhooks');
    process.exit(1);
  }
  console.log('PASS: Dry-run skips webhook delivery, returns empty results');

  console.log('\n=== All tests passed ===');
}

runTest().catch((err) => {
  console.error(`Test FATAL: ${err.message}`);
  process.exit(1);
});
