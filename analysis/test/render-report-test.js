#!/usr/bin/env node
// Unit tests for analysis/render-report.js
// Verifies: template loading, placeholder replacement, HTML structure,
//           graceful degradation with missing data, output size.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

function setupSession(dir, summaryOverrides, followUpOverrides, timelineOverrides) {
  const outputDir = path.join(dir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const summary = Object.assign({
    session_id: 'TEST001',
    visitor_name: 'Test Visitor',
    visitor_company: 'Test Corp',
    se_name: 'Test SE',
    demo_duration_minutes: 12,
    products_shown: ['XDR', 'Endpoint Security'],
    visitor_interests: [
      { topic: 'Detection Rules', confidence: 'high', evidence: 'Asked 3 questions about rules' },
      { topic: 'Cloud Posture', confidence: 'medium', evidence: 'Mentioned AWS accounts' },
    ],
    recommended_follow_up: [
      'Schedule deep-dive on detection rules',
      'Share cloud security whitepaper',
    ],
    key_moments: [
      { timestamp: '02:15', description: 'Asked about SIEM integration' },
      { timestamp: '08:30', description: 'Explored detection rules editor' },
    ],
    generated_at: '2026-08-06T10:35:00Z',
  }, summaryOverrides || {});

  const followUp = Object.assign({
    session_id: 'TEST001',
    visitor_email: 'test@example.com',
    visitor_company: 'Test Corp',
    priority: 'high',
    tags: ['xdr', 'cloud'],
    sdr_notes: 'Test visitor is a SOC manager evaluating XDR solutions.',
  }, followUpOverrides || {});

  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outputDir, 'follow-up.json'), JSON.stringify(followUp, null, 2));

  if (timelineOverrides !== null) {
    const timeline = Object.assign({
      session_id: 'TEST001',
      event_count: 4,
      click_count: 2,
      speech_count: 2,
      events: [
        { type: 'speech', timestamp: '00:30', speaker: 'SE', text: 'Welcome to the demo' },
        { type: 'click', timestamp: '01:00', element_text: 'XDR', page_title: 'Dashboard' },
        { type: 'speech', timestamp: '02:15', speaker: 'Visitor', text: 'How does this integrate?' },
        { type: 'click', timestamp: '03:00', element_text: 'Rules', page_title: 'XDR' },
      ],
    }, timelineOverrides || {});
    fs.writeFileSync(path.join(outputDir, 'timeline.json'), JSON.stringify(timeline, null, 2));
  }

  return dir;
}

function runRenderer(sessionDir) {
  const script = path.join(__dirname, '..', 'render-report.js');
  execFileSync('node', [script, sessionDir], { stdio: 'pipe', timeout: 10000 });
  return fs.readFileSync(path.join(sessionDir, 'output', 'summary.html'), 'utf8');
}

// ─── Test 1: Full data — all placeholders replaced ───────────────────────────

console.log('\nTest 1: Full data — all placeholders replaced');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-'));
  setupSession(dir);
  const html = runRenderer(dir);

  assert(!html.includes('{{'), 'no unreplaced {{placeholders}} in output');
  assert(html.includes('Test Visitor'), 'visitor name present');
  assert(html.includes('Test Corp'), 'company name present');
  assert(html.includes('Test SE'), 'SE name present');
  assert(html.includes('12 min'), 'duration present');
  assert(html.includes('XDR'), 'product badge present');
  assert(html.includes('Detection Rules'), 'interest topic present');
  assert(html.includes('Welcome to the demo'), 'timeline speech present');
  assert(html.includes('CLICK'), 'timeline click label present');
  assert(html.includes('Schedule deep-dive'), 'follow-up action present');
  assert(html.includes('SOC manager'), 'SDR notes present');

  fs.rmSync(dir, { recursive: true });
}

// ─── Test 2: Missing timeline.json — falls back to key_moments ───────────────

console.log('\nTest 2: Missing timeline.json — falls back to key_moments');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-'));
  setupSession(dir, {}, {}, null); // null = don't write timeline.json
  const html = runRenderer(dir);

  assert(!html.includes('{{'), 'no unreplaced placeholders');
  assert(html.includes('Asked about SIEM integration'), 'key_moment description used as fallback');
  assert(html.includes('Explored detection rules editor'), 'second key_moment present');

  fs.rmSync(dir, { recursive: true });
}

// ─── Test 3: Missing follow-up.json — graceful defaults ─────────────────────

console.log('\nTest 3: Missing follow-up.json — graceful defaults');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-'));
  setupSession(dir);
  // Delete follow-up.json
  fs.unlinkSync(path.join(dir, 'output', 'follow-up.json'));
  const html = runRenderer(dir);

  assert(!html.includes('{{'), 'no unreplaced placeholders');
  assert(html.includes('Test Visitor'), 'visitor name still present from summary');
  assert(html.includes('<!DOCTYPE html>'), 'valid HTML document');

  fs.rmSync(dir, { recursive: true });
}

// ─── Test 4: Empty arrays — no crash, shows empty state ─────────────────────

console.log('\nTest 4: Empty arrays — shows empty state gracefully');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-'));
  setupSession(dir, {
    products_shown: [],
    visitor_interests: [],
    recommended_follow_up: [],
    key_moments: [],
  }, {}, { events: [] });
  const html = runRenderer(dir);

  assert(!html.includes('{{'), 'no unreplaced placeholders');
  assert(html.includes('No products recorded') || html.includes('empty'), 'empty products state');
  assert(html.includes('No interests recorded') || html.includes('empty'), 'empty interests state');

  fs.rmSync(dir, { recursive: true });
}

// ─── Test 5: HTML escaping — XSS prevention ─────────────────────────────────

console.log('\nTest 5: HTML escaping — XSS prevention');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-'));
  setupSession(dir, {
    visitor_name: '<script>alert("xss")</script>',
    products_shown: ['<img onerror=alert(1)>'],
    visitor_interests: [{
      topic: '"><script>alert(1)</script>',
      confidence: 'high',
      evidence: 'O\'Reilly & Associates',
    }],
  });
  const html = runRenderer(dir);

  assert(!html.includes('<script>alert'), 'script tags are escaped');
  assert(!html.includes('<img onerror='), 'event handlers not in executable context');
  assert(html.includes('&lt;script&gt;'), 'angle brackets escaped to entities');
  assert(html.includes('O&#39;Reilly &amp; Associates'), 'quotes and ampersands escaped');

  fs.rmSync(dir, { recursive: true });
}

// ─── Test 6: Output size is reasonable ───────────────────────────────────────

console.log('\nTest 6: Output size is reasonable');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-'));
  setupSession(dir);
  const html = runRenderer(dir);
  const sizeKb = Buffer.byteLength(html) / 1024;

  assert(sizeKb < 100, `HTML size ${sizeKb.toFixed(1)}KB is under 100KB`);
  assert(sizeKb > 5, `HTML size ${sizeKb.toFixed(1)}KB is not suspiciously small`);

  fs.rmSync(dir, { recursive: true });
}

// ─── Test 7: Print CSS is present ────────────────────────────────────────────

console.log('\nTest 7: Print CSS is present');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-'));
  setupSession(dir);
  const html = runRenderer(dir);

  assert(html.includes('@media print'), 'print media query present');
  assert(html.includes('@page'), '@page rule present');
  assert(html.includes('break-inside: avoid'), 'page break control present');

  fs.rmSync(dir, { recursive: true });
}

// ─── Test 8: Session score computation ───────────────────────────────────────

console.log('\nTest 8: Session score computation');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-'));
  setupSession(dir);
  const html = runRenderer(dir);

  // With 1 high + 1 medium interest, 2 products, 2 moments, high priority, 12min duration:
  // 50 + 10 + 5 + 10 + 6 + 10 = 91
  const scoreMatch = html.match(/class="score-num">(\d+)</);
  assert(scoreMatch, 'score value found in HTML');
  const score = parseInt(scoreMatch[1], 10);
  assert(score >= 50, `score ${score} is at least baseline 50`);
  assert(score <= 100, `score ${score} is capped at 100`);

  fs.rmSync(dir, { recursive: true });
}

// ─── Test 9: Metadata fallback — se_name and duration from metadata.json ─────

console.log('\nTest 9: Metadata fallback — se_name and duration from metadata.json');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-'));
  // Setup session WITHOUT se_name or demo_duration in summary.json
  setupSession(dir, { se_name: undefined, demo_duration_minutes: undefined });

  // Write metadata.json at session root (like S3 layout)
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
    session_id: 'TEST001',
    visitor_name: 'Test Visitor',
    se_name: 'Metadata SE',
    started_at: '2026-08-06T10:00:00Z',
    ended_at: '2026-08-06T10:20:00Z',
  }, null, 2));

  const html = runRenderer(dir);

  assert(html.includes('Metadata SE'), 'se_name falls back to metadata.json');
  assert(html.includes('20 min'), 'duration computed from metadata timestamps');

  fs.rmSync(dir, { recursive: true });
}

// ─── Results ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
