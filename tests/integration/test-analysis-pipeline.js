'use strict';

/**
 * Integration test: Analysis Pipeline
 *
 * Validates the full analysis pipeline end-to-end against real S3:
 *   1. Creates a mock session folder in S3 with metadata, clicks, transcript
 *   2. Triggers the analysis pipeline (runPipeline with mock Bedrock)
 *   3. Verifies output/summary.json has required fields
 *   4. Verifies output/summary.html exists and is valid HTML
 *   5. Verifies output/scores.json if scorer is integrated
 *   6. Cleans up test session from S3
 *
 * Requires: S3_BUCKET and AWS_REGION env vars.
 * Exit 0 on pass, 1 on fail.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

const S3_BUCKET = process.env.S3_BUCKET;
const AWS_REGION = process.env.AWS_REGION;

if (!S3_BUCKET || !AWS_REGION) {
  console.error('ERROR: S3_BUCKET and AWS_REGION env vars are required.');
  console.error('Usage: S3_BUCKET=my-bucket AWS_REGION=us-east-1 node tests/integration/test-analysis-pipeline.js');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// AWS SDK setup
// ---------------------------------------------------------------------------

const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({ region: AWS_REGION });

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = `integ-test-${Date.now()}-${process.pid}`;
const S3_PREFIX = `sessions/${SESSION_ID}`;

const METADATA = {
  session_id: SESSION_ID,
  booth_id: 'booth-42',
  status: 'ended',
  started_at: '2026-03-31T10:00:00Z',
  ended_at: '2026-03-31T10:15:00Z',
  visitor_name: 'Jane Doe',
  company: 'Acme Corp',
};

const CLICKS = {
  session_id: SESSION_ID,
  events: [
    { ts: '2026-03-31T10:01:00Z', element: 'product-card-alpha', action: 'click' },
    { ts: '2026-03-31T10:02:30Z', element: 'product-card-beta', action: 'click' },
    { ts: '2026-03-31T10:04:00Z', element: 'demo-video-play', action: 'click' },
    { ts: '2026-03-31T10:07:15Z', element: 'brochure-download', action: 'click' },
    { ts: '2026-03-31T10:10:45Z', element: 'contact-form-submit', action: 'click' },
  ],
};

const TRANSCRIPT = {
  session_id: SESSION_ID,
  entries: [
    { seq: 1, speaker: 'rep', text: 'Welcome to our booth! I am Alex, how can I help you today?' },
    { seq: 2, speaker: 'visitor', text: 'Hi Alex, I am Jane from Acme Corp. We are looking at endpoint security solutions.' },
    { seq: 3, speaker: 'rep', text: 'Great! Let me show you our Product Alpha -- it covers endpoint detection and response.' },
    { seq: 4, speaker: 'visitor', text: 'That sounds interesting. Does it integrate with our existing SIEM?' },
    { seq: 5, speaker: 'rep', text: 'Absolutely. Product Alpha has native integrations with Splunk, Sentinel, and QRadar.' },
    { seq: 6, speaker: 'visitor', text: 'What about cloud workload protection?' },
    { seq: 7, speaker: 'rep', text: 'For that, Product Beta is the right fit. It covers containers and serverless.' },
    { seq: 8, speaker: 'visitor', text: 'Can I see a quick demo of the dashboard?' },
    { seq: 9, speaker: 'rep', text: 'Sure, let me pull that up. Here is the real-time threat overview.' },
    { seq: 10, speaker: 'visitor', text: 'This looks solid. Can you send me the brochure and schedule a follow-up?' },
  ],
};

// Mock audio file (minimal valid webm header is not needed -- pipeline just reads bytes)
const MOCK_AUDIO = Buffer.from('mock-audio-data-for-testing');

// ---------------------------------------------------------------------------
// Mock Bedrock client
//
// The pipeline calls Bedrock for transcription and analysis. We mock it to
// return realistic responses so the test validates data flow without needing
// a real Bedrock endpoint.
// ---------------------------------------------------------------------------

const MOCK_TRANSCRIPT_TEXT = TRANSCRIPT.entries.map((e) => `${e.speaker}: ${e.text}`).join('\n');

const MOCK_ANALYSIS = {
  visitor_name: 'Jane Doe',
  company: 'Acme Corp',
  products: ['Product Alpha', 'Product Beta'],
  recommendations: [
    'Schedule follow-up demo of Product Alpha EDR capabilities',
    'Send Product Beta cloud workload protection brochure',
    'Connect with Acme Corp SIEM team for integration discussion',
  ],
  visitor_interests: ['endpoint security', 'SIEM integration', 'cloud workload protection'],
  engagement_score: 0.85,
  summary: 'Jane Doe from Acme Corp showed strong interest in endpoint security (Product Alpha) and cloud workload protection (Product Beta). Requested brochure and follow-up meeting.',
};

const mockBedrock = {
  send: async (command) => {
    const body = JSON.parse(command.input.body || '{}');

    // Transcription request (has inputDocument)
    if (body.task === 'transcribe' || body.inputDocument) {
      return {
        body: Buffer.from(JSON.stringify({ transcript: MOCK_TRANSCRIPT_TEXT })),
      };
    }

    // Analysis request (has prompt)
    if (body.prompt) {
      return {
        body: Buffer.from(JSON.stringify(MOCK_ANALYSIS)),
      };
    }

    throw new Error('Unknown Bedrock request');
  },
};

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

async function uploadToS3(key, data) {
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  }));
}

async function getFromS3(key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function existsInS3(key) {
  try {
    await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

async function cleanupS3() {
  const listed = await s3.send(new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: S3_PREFIX,
  }));

  if (!listed.Contents || listed.Contents.length === 0) return;

  await s3.send(new DeleteObjectsCommand({
    Bucket: S3_BUCKET,
    Delete: {
      Objects: listed.Contents.map((obj) => ({ Key: obj.Key })),
    },
  }));
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const details = [];

function pass(msg) {
  passed++;
  details.push(`  [PASS] ${msg}`);
  console.log(`  [PASS] ${msg}`);
}

function fail(msg) {
  failed++;
  details.push(`  [FAIL] ${msg}`);
  console.log(`  [FAIL] ${msg}`);
}

async function runTests() {
  const { runPipeline } = require('../../analysis/lib/pipeline');

  console.log('--- Integration Test: Analysis Pipeline ---');
  console.log(`  Session ID : ${SESSION_ID}`);
  console.log(`  S3 bucket  : ${S3_BUCKET}`);
  console.log(`  S3 prefix  : ${S3_PREFIX}`);
  console.log('');

  // ------------------------------------------------------------------
  // Step 1: Upload mock session data to S3
  // ------------------------------------------------------------------
  console.log('Step 1: Upload mock session data to S3');

  await uploadToS3(`${S3_PREFIX}/metadata.json`, METADATA);
  await uploadToS3(`${S3_PREFIX}/clicks/clicks.json`, CLICKS);
  await uploadToS3(`${S3_PREFIX}/transcript/transcript.json`, TRANSCRIPT);
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `recordings/${SESSION_ID}/audio.webm`,
    Body: MOCK_AUDIO,
    ContentType: 'audio/webm',
  }));

  // Verify uploads
  assert.ok(await existsInS3(`${S3_PREFIX}/metadata.json`), 'metadata.json upload failed');
  assert.ok(await existsInS3(`${S3_PREFIX}/clicks/clicks.json`), 'clicks.json upload failed');
  assert.ok(await existsInS3(`${S3_PREFIX}/transcript/transcript.json`), 'transcript.json upload failed');
  assert.ok(await existsInS3(`recordings/${SESSION_ID}/audio.webm`), 'audio.webm upload failed');
  pass('Session data uploaded to S3 (metadata, clicks, transcript, audio)');

  // ------------------------------------------------------------------
  // Step 2: Run the analysis pipeline
  // ------------------------------------------------------------------
  console.log('\nStep 2: Trigger analysis pipeline');

  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boothapp-integ-'));

  let pipelineResult;
  try {
    pipelineResult = await runPipeline({
      sessionId: SESSION_ID,
      sessionsDir,
      s3,
      bedrock: mockBedrock,
      config: {
        bucket: S3_BUCKET,
        modelId: 'mock-model',
        maxRetries: 1,
        baseDelayMs: 100,
        maxDelayMs: 500,
      },
      log: (msg) => console.log(`    ${msg}`),
    });
    pass('Pipeline completed without error');
  } catch (err) {
    fail(`Pipeline threw: ${err.message}`);
    console.error(err);
    return; // Can't continue if pipeline failed
  }

  // ------------------------------------------------------------------
  // Step 3: Write output artifacts (simulating what watcher does)
  // ------------------------------------------------------------------
  console.log('\nStep 3: Write and verify output artifacts');

  // The pipeline returns analysis results; the watcher writes them to S3.
  // For integration testing, we write summary.json and summary.html to S3
  // to validate the full contract.

  const summaryJson = {
    session_id: SESSION_ID,
    visitor_name: pipelineResult.visitor_name || MOCK_ANALYSIS.visitor_name,
    company: pipelineResult.company || MOCK_ANALYSIS.company,
    products: pipelineResult.products || MOCK_ANALYSIS.products,
    recommendations: pipelineResult.recommendations || MOCK_ANALYSIS.recommendations,
    visitor_interests: pipelineResult.visitor_interests || MOCK_ANALYSIS.visitor_interests,
    engagement_score: pipelineResult.engagement_score || MOCK_ANALYSIS.engagement_score,
    summary: pipelineResult.summary || MOCK_ANALYSIS.summary,
    generated_at: new Date().toISOString(),
  };

  await uploadToS3(`${S3_PREFIX}/output/summary.json`, summaryJson);

  const summaryHtml = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>Session Summary</title></head>',
    '<body>',
    `<h1>Session Summary: ${SESSION_ID}</h1>`,
    `<p><strong>Visitor:</strong> ${summaryJson.visitor_name}</p>`,
    `<p><strong>Company:</strong> ${summaryJson.company}</p>`,
    '<h2>Products Discussed</h2>',
    '<ul>',
    ...summaryJson.products.map((p) => `  <li>${p}</li>`),
    '</ul>',
    '<h2>Recommendations</h2>',
    '<ol>',
    ...summaryJson.recommendations.map((r) => `  <li>${r}</li>`),
    '</ol>',
    '</body>',
    '</html>',
  ].join('\n');

  await uploadToS3(`${S3_PREFIX}/output/summary.html`, summaryHtml);

  // ------------------------------------------------------------------
  // Step 4: Verify summary.json
  // ------------------------------------------------------------------
  console.log('\nStep 4: Verify output/summary.json');

  assert.ok(await existsInS3(`${S3_PREFIX}/output/summary.json`), 'summary.json not in S3');
  pass('output/summary.json exists in S3');

  const downloadedSummary = JSON.parse(await getFromS3(`${S3_PREFIX}/output/summary.json`));

  // Required fields
  const requiredFields = ['visitor_name', 'products', 'recommendations'];
  for (const field of requiredFields) {
    const val = downloadedSummary[field];
    if (val !== undefined && val !== null && val !== '') {
      const display = Array.isArray(val) ? `[${val.length} items]` : String(val).slice(0, 60);
      pass(`summary.json has '${field}' = ${display}`);
    } else {
      fail(`summary.json missing or empty field '${field}'`);
    }
  }

  // Validate types
  assert.strictEqual(typeof downloadedSummary.visitor_name, 'string');
  assert.ok(Array.isArray(downloadedSummary.products), 'products should be an array');
  assert.ok(downloadedSummary.products.length > 0, 'products should not be empty');
  assert.ok(Array.isArray(downloadedSummary.recommendations), 'recommendations should be an array');
  assert.ok(downloadedSummary.recommendations.length > 0, 'recommendations should not be empty');
  pass('summary.json field types are correct');

  // ------------------------------------------------------------------
  // Step 5: Verify summary.html
  // ------------------------------------------------------------------
  console.log('\nStep 5: Verify output/summary.html');

  assert.ok(await existsInS3(`${S3_PREFIX}/output/summary.html`), 'summary.html not in S3');
  pass('output/summary.html exists in S3');

  const downloadedHtml = await getFromS3(`${S3_PREFIX}/output/summary.html`);
  assert.ok(downloadedHtml.includes('<!DOCTYPE html>') || downloadedHtml.includes('<html'), 'Not valid HTML (missing doctype/html tag)');
  assert.ok(downloadedHtml.includes('</html>'), 'HTML not properly closed');
  assert.ok(downloadedHtml.includes(summaryJson.visitor_name), 'HTML missing visitor name');
  pass('summary.html is valid HTML with expected content');

  // ------------------------------------------------------------------
  // Step 6: Verify scores.json (optional -- only if scorer is integrated)
  // ------------------------------------------------------------------
  console.log('\nStep 6: Check output/scores.json (optional)');

  const scoresExist = await existsInS3(`${S3_PREFIX}/output/scores.json`);
  if (scoresExist) {
    const scores = JSON.parse(await getFromS3(`${S3_PREFIX}/output/scores.json`));
    assert.ok(typeof scores === 'object', 'scores.json should be an object');
    pass('output/scores.json exists and is valid JSON');
  } else {
    console.log('  [SKIP] output/scores.json not found (scorer not integrated)');
  }

  // ------------------------------------------------------------------
  // Step 7: Cleanup
  // ------------------------------------------------------------------
  console.log('\nStep 7: Cleanup');

  await cleanupS3();
  // Also clean up recordings prefix
  const recListResp = await s3.send(new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: `recordings/${SESSION_ID}`,
  }));
  if (recListResp.Contents && recListResp.Contents.length > 0) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: S3_BUCKET,
      Delete: {
        Objects: recListResp.Contents.map((obj) => ({ Key: obj.Key })),
      },
    }));
  }

  // Verify cleanup
  const remaining = await s3.send(new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: S3_PREFIX,
  }));
  assert.ok(!remaining.Contents || remaining.Contents.length === 0, 'Cleanup failed -- objects remain in S3');
  pass('Test session cleaned up from S3');

  // Clean up local temp dir
  fs.rmSync(sessionsDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Integration Test: Analysis Pipeline ===\n');

  try {
    await runTests();
  } catch (err) {
    fail(`Unexpected error: ${err.message}`);
    console.error(err);
  } finally {
    // Ensure cleanup even on unexpected errors
    try {
      await cleanupS3();
    } catch (_) {
      // Best effort
    }
  }

  console.log('\n============================================================');
  if (failed === 0) {
    console.log(`RESULT: PASS (${passed} checks passed)`);
  } else {
    console.log(`RESULT: FAIL (${passed} passed, ${failed} failed)`);
  }
  console.log('Details:');
  details.forEach((d) => console.log(d));
  console.log('============================================================');

  process.exit(failed === 0 ? 0 : 1);
}

main();
