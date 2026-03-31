'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  correlate,
  correlateSession,
  detectProduct,
  listScreenshots,
  matchScreenshot,
  findSpeaker,
  findTranscriptText,
  clusterInteractions,
} = require('../analysis/lib/correlator');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL: ${name} -- ${err.message}`);
    failed++;
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'correlator-test-'));
}

console.log('Correlator tests\n');

// ---------------------------------------------------------------------------
// detectProduct
// ---------------------------------------------------------------------------

test('detectProduct matches XDR URL', () => {
  assert.strictEqual(detectProduct('/app/xdr/workbench'), 'Vision One XDR');
});

test('detectProduct matches endpoint security URL', () => {
  assert.strictEqual(detectProduct('/app/epp/endpoint-protection'), 'Endpoint Security');
});

test('detectProduct matches ZTSA URL', () => {
  assert.strictEqual(detectProduct('/app/zero/endpoints'), 'Zero Trust Secure Access');
});

test('detectProduct matches cloud security URL', () => {
  assert.strictEqual(detectProduct('/app/cloud/container-security'), 'Cloud Security');
});

test('detectProduct matches email security URL', () => {
  assert.strictEqual(detectProduct('/app/email/inbox'), 'Email Security');
});

test('detectProduct matches network security URL', () => {
  assert.strictEqual(detectProduct('/app/network/ips'), 'Network Security');
});

test('detectProduct matches server workload URL', () => {
  assert.strictEqual(detectProduct('/app/epp/workload-protection'), 'Server & Workload Protection');
});

test('detectProduct returns null for unknown URL', () => {
  assert.strictEqual(detectProduct('/app/settings/account'), null);
});

test('detectProduct returns null for empty string', () => {
  assert.strictEqual(detectProduct(''), null);
});

test('detectProduct returns null for null', () => {
  assert.strictEqual(detectProduct(null), null);
});

test('detectProduct matches case-insensitive', () => {
  assert.strictEqual(detectProduct('/APP/XDR/Dashboard'), 'Vision One XDR');
});

// ---------------------------------------------------------------------------
// listScreenshots
// ---------------------------------------------------------------------------

test('listScreenshots returns empty for missing dir', () => {
  assert.deepStrictEqual(listScreenshots('/nonexistent'), []);
});

test('listScreenshots returns empty for null', () => {
  assert.deepStrictEqual(listScreenshots(null), []);
});

test('listScreenshots reads and sorts screenshot files', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'click-003.jpg'), '');
  fs.writeFileSync(path.join(dir, 'click-001.jpg'), '');
  fs.writeFileSync(path.join(dir, 'click-002.jpg'), '');
  fs.writeFileSync(path.join(dir, 'readme.txt'), ''); // ignored

  const result = listScreenshots(dir);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].index, 1);
  assert.strictEqual(result[1].index, 2);
  assert.strictEqual(result[2].index, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// matchScreenshot
// ---------------------------------------------------------------------------

test('matchScreenshot returns null for empty list', () => {
  assert.strictEqual(matchScreenshot(1, []), null);
});

test('matchScreenshot returns exact match', () => {
  const screenshots = [{ file: 'click-001.jpg', index: 1 }, { file: 'click-002.jpg', index: 2 }];
  assert.strictEqual(matchScreenshot(2, screenshots), 'click-002.jpg');
});

test('matchScreenshot returns closest when no exact match', () => {
  const screenshots = [{ file: 'click-001.jpg', index: 1 }, { file: 'click-005.jpg', index: 5 }];
  assert.strictEqual(matchScreenshot(3, screenshots), 'click-001.jpg'); // 3-1=2 < 5-3=2, first wins
});

test('matchScreenshot picks closer screenshot', () => {
  const screenshots = [{ file: 'click-001.jpg', index: 1 }, { file: 'click-010.jpg', index: 10 }];
  assert.strictEqual(matchScreenshot(8, screenshots), 'click-010.jpg');
});

// ---------------------------------------------------------------------------
// findSpeaker
// ---------------------------------------------------------------------------

test('findSpeaker returns null for empty transcript', () => {
  assert.strictEqual(findSpeaker(5000, []), null);
});

test('findSpeaker returns speaker when timestamp falls in segment', () => {
  const transcript = [
    { start_ms: 1000, end_ms: 3000, text: 'Hello', speaker: 'Rep' },
    { start_ms: 3000, end_ms: 5000, text: 'Hi there', speaker: 'Visitor' },
  ];
  assert.strictEqual(findSpeaker(2000, transcript), 'Rep');
  assert.strictEqual(findSpeaker(4000, transcript), 'Visitor');
});

test('findSpeaker returns null when no speaker labels', () => {
  const transcript = [{ start_ms: 1000, end_ms: 3000, text: 'Hello' }];
  assert.strictEqual(findSpeaker(2000, transcript), null);
});

test('findSpeaker falls back to closest within 2s', () => {
  const transcript = [
    { start_ms: 1000, end_ms: 2000, text: 'Hello', speaker: 'Rep' },
  ];
  // 3500 is 1500ms from end of segment (mid=1500, dist=2000) -- within 2s
  assert.strictEqual(findSpeaker(3500, transcript), 'Rep');
});

test('findSpeaker returns null when beyond 2s fallback', () => {
  const transcript = [
    { start_ms: 1000, end_ms: 2000, text: 'Hello', speaker: 'Rep' },
  ];
  assert.strictEqual(findSpeaker(10000, transcript), null);
});

// ---------------------------------------------------------------------------
// findTranscriptText
// ---------------------------------------------------------------------------

test('findTranscriptText returns text for matching segment', () => {
  const transcript = [
    { start_ms: 1000, end_ms: 3000, text: 'Hello world' },
  ];
  assert.strictEqual(findTranscriptText(2000, transcript), 'Hello world');
});

test('findTranscriptText returns null for empty', () => {
  assert.strictEqual(findTranscriptText(2000, []), null);
});

test('findTranscriptText falls back within 2s', () => {
  const transcript = [
    { start_ms: 1000, end_ms: 2000, text: 'Nearby' },
  ];
  assert.strictEqual(findTranscriptText(3000, transcript), 'Nearby');
});

// ---------------------------------------------------------------------------
// clusterInteractions
// ---------------------------------------------------------------------------

test('clusterInteractions returns empty for empty clicks', () => {
  assert.deepStrictEqual(clusterInteractions([]), []);
});

test('clusterInteractions groups rapid clicks', () => {
  const clicks = [
    { timestamp: 1000 },
    { timestamp: 1500 },
    { timestamp: 2000 },
    { timestamp: 8000 },
    { timestamp: 8500 },
  ];
  const clusters = clusterInteractions(clicks, 2000);
  assert.strictEqual(clusters.length, 2);
  assert.strictEqual(clusters[0].clicks.length, 3);
  assert.strictEqual(clusters[1].clicks.length, 2);
});

test('clusterInteractions single click is one cluster', () => {
  const clicks = [{ timestamp: 5000 }];
  const clusters = clusterInteractions(clicks, 2000);
  assert.strictEqual(clusters.length, 1);
  assert.strictEqual(clusters[0].durationMs, 0);
});

test('clusterInteractions all clicks within gap is one cluster', () => {
  const clicks = [
    { timestamp: 1000 },
    { timestamp: 2000 },
    { timestamp: 3000 },
  ];
  const clusters = clusterInteractions(clicks, 2000);
  assert.strictEqual(clusters.length, 1);
  assert.strictEqual(clusters[0].click_count || clusters[0].clicks.length, 3);
});

test('clusterInteractions each click separate when gap exceeded', () => {
  const clicks = [
    { timestamp: 1000 },
    { timestamp: 5000 },
    { timestamp: 9000 },
  ];
  const clusters = clusterInteractions(clicks, 1000);
  assert.strictEqual(clusters.length, 3);
});

test('clusterInteractions respects custom gap', () => {
  const clicks = [
    { timestamp: 1000 },
    { timestamp: 1100 },
    { timestamp: 5000 },
  ];
  const clusters = clusterInteractions(clicks, 500);
  assert.strictEqual(clusters.length, 2);
});

// ---------------------------------------------------------------------------
// correlate (full pipeline)
// ---------------------------------------------------------------------------

test('correlate returns version 2 timeline', () => {
  const result = correlate({ clicks: [] });
  assert.strictEqual(result.version, 2);
  assert.ok(result.generated_at);
  assert.ok(Array.isArray(result.events));
  assert.ok(Array.isArray(result.interactions));
});

test('correlate enriches clicks with product and transcript', () => {
  const clicks = [
    { timestamp: 2000, url: '/app/xdr/workbench', element: 'button', x: 100, y: 200 },
  ];
  const transcript = [
    { start_ms: 1000, end_ms: 3000, text: 'Looking at XDR', speaker: 'Rep' },
  ];
  const result = correlate({ clicks, transcript });

  assert.strictEqual(result.events.length, 1);
  const ev = result.events[0];
  assert.strictEqual(ev.product, 'Vision One XDR');
  assert.strictEqual(ev.speaker, 'Rep');
  assert.strictEqual(ev.transcript_text, 'Looking at XDR');
  assert.strictEqual(ev.type, 'click');
});

test('correlate builds interactions from clusters', () => {
  const clicks = [
    { timestamp: 1000, url: '/app/xdr/a' },
    { timestamp: 1500, url: '/app/xdr/b' },
    { timestamp: 5000, url: '/app/email/c' },
  ];
  const result = correlate({ clicks });

  assert.strictEqual(result.interactions.length, 2);
  assert.strictEqual(result.interactions[0].click_count, 2);
  assert.strictEqual(result.interactions[0].product, 'Vision One XDR');
  assert.strictEqual(result.interactions[1].click_count, 1);
  assert.strictEqual(result.interactions[1].product, 'Email Security');
});

test('correlate includes products_visited summary', () => {
  const clicks = [
    { timestamp: 1000, url: '/app/xdr/a' },
    { timestamp: 2000, url: '/app/zero/b' },
    { timestamp: 3000, url: '/app/xdr/c' },
  ];
  const result = correlate({ clicks });
  assert.ok(result.summary.products_visited.includes('Vision One XDR'));
  assert.ok(result.summary.products_visited.includes('Zero Trust Secure Access'));
  assert.strictEqual(result.summary.products_visited.length, 2);
});

test('correlate includes speaker summary', () => {
  const transcript = [
    { start_ms: 0, end_ms: 2000, text: 'Hello', speaker: 'Rep' },
    { start_ms: 2000, end_ms: 4000, text: 'Hi', speaker: 'Visitor' },
    { start_ms: 4000, end_ms: 6000, text: 'Let me show', speaker: 'Rep' },
  ];
  const result = correlate({ clicks: [{ timestamp: 1000 }], transcript });
  assert.strictEqual(result.summary.speakers.length, 2);
  const rep = result.summary.speakers.find((s) => s.speaker === 'Rep');
  assert.strictEqual(rep.segments, 2);
  assert.strictEqual(rep.total_ms, 4000);
});

test('correlate includes badge data', () => {
  const badge = { name: 'Test User', company: 'Acme' };
  const result = correlate({ clicks: [], badge });
  assert.deepStrictEqual(result.badge, badge);
});

test('correlate computes duration_ms', () => {
  const clicks = [
    { timestamp: 1000 },
    { timestamp: 5000 },
  ];
  const result = correlate({ clicks });
  assert.strictEqual(result.summary.duration_ms, 4000);
});

test('correlate handles empty inputs gracefully', () => {
  const result = correlate({ clicks: [], transcript: [] });
  assert.strictEqual(result.events.length, 0);
  assert.strictEqual(result.interactions.length, 0);
  assert.strictEqual(result.summary.duration_ms, 0);
});

// ---------------------------------------------------------------------------
// correlateSession (file-based)
// ---------------------------------------------------------------------------

test('correlateSession reads session directory', () => {
  const dir = tmpDir();
  const clicks = [
    { timestamp: 1000, url: '/app/xdr/dash', element: 'a', x: 10, y: 20 },
    { timestamp: 3000, url: '/app/email/inbox', element: 'div', x: 30, y: 40 },
  ];
  const transcript = [
    { start_ms: 500, end_ms: 2000, text: 'XDR dashboard', speaker: 'Rep' },
    { start_ms: 2500, end_ms: 4000, text: 'Email security', speaker: 'Visitor' },
  ];
  const badge = { name: 'Jane Doe', company: 'TestCorp' };

  fs.writeFileSync(path.join(dir, 'clicks.json'), JSON.stringify(clicks));
  fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify(transcript));
  fs.writeFileSync(path.join(dir, 'badge.json'), JSON.stringify(badge));

  const ssDir = path.join(dir, 'screenshots');
  fs.mkdirSync(ssDir);
  fs.writeFileSync(path.join(ssDir, 'click-001.jpg'), '');
  fs.writeFileSync(path.join(ssDir, 'click-002.jpg'), '');

  const result = correlateSession(dir);

  assert.strictEqual(result.events.length, 2);
  assert.strictEqual(result.events[0].product, 'Vision One XDR');
  assert.strictEqual(result.events[0].speaker, 'Rep');
  assert.strictEqual(result.events[0].screenshot, 'click-001.jpg');
  assert.strictEqual(result.events[1].product, 'Email Security');
  assert.strictEqual(result.events[1].speaker, 'Visitor');
  assert.strictEqual(result.events[1].screenshot, 'click-002.jpg');
  assert.deepStrictEqual(result.badge, badge);
  assert.strictEqual(result.summary.products_visited.length, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('correlateSession handles missing files gracefully', () => {
  const dir = tmpDir();
  const result = correlateSession(dir);
  assert.strictEqual(result.events.length, 0);
  assert.strictEqual(result.badge, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
