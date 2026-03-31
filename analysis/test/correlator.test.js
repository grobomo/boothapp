'use strict';

const assert = require('assert');
const {
  correlate,
  matchScreenshots,
  detectTopics,
  engagementScore,
} = require('../lib/correlator');

// ---------------------------------------------------------------------------
// matchScreenshots
// ---------------------------------------------------------------------------

console.log('--- matchScreenshots ---');

{
  const ss = [
    { timestamp: 1000, url: 'ss1.png' },
    { timestamp: 2500, url: 'ss2.png' },
    { timestamp: 5000, url: 'ss3.png' },
  ];
  const urls = matchScreenshots(1500, ss, 2000);
  assert.deepStrictEqual(urls, ['ss1.png', 'ss2.png']);
  console.log('  [PASS] matches within 2s window');
}

{
  const urls = matchScreenshots(1000, [], 2000);
  assert.deepStrictEqual(urls, []);
  console.log('  [PASS] empty screenshots returns empty');
}

{
  const urls = matchScreenshots(1000, null, 2000);
  assert.deepStrictEqual(urls, []);
  console.log('  [PASS] null screenshots returns empty');
}

{
  const ss = [{ timestamp: 10000, url: 'far.png' }];
  const urls = matchScreenshots(1000, ss, 2000);
  assert.deepStrictEqual(urls, []);
  console.log('  [PASS] no match outside window');
}

// ---------------------------------------------------------------------------
// detectTopics
// ---------------------------------------------------------------------------

console.log('\n--- detectTopics ---');

{
  const t = detectTopics('https://example.com/xdr/alerts', '');
  assert.ok(t.includes('XDR'));
  console.log('  [PASS] detects XDR from URL');
}

{
  const t = detectTopics(null, 'We discussed endpoint security and zero trust access');
  assert.ok(t.includes('Endpoint Security'));
  assert.ok(t.includes('ZTSA'));
  console.log('  [PASS] detects multiple topics from text');
}

{
  const t = detectTopics(null, 'the weather is nice');
  assert.deepStrictEqual(t, []);
  console.log('  [PASS] no topics for unrelated text');
}

{
  const t = detectTopics('https://app.com/cloud-security/dashboard', 'email security overview');
  assert.ok(t.includes('Cloud Security'));
  assert.ok(t.includes('Email Security'));
  console.log('  [PASS] detects topics from both URL and text');
}

// ---------------------------------------------------------------------------
// engagementScore
// ---------------------------------------------------------------------------

console.log('\n--- engagementScore ---');

{
  assert.strictEqual(engagementScore(3, true), 'high');
  console.log('  [PASS] clicks + dialogue = high');
}

{
  assert.strictEqual(engagementScore(2, false), 'medium');
  console.log('  [PASS] clicks only = medium');
}

{
  assert.strictEqual(engagementScore(0, true), 'medium');
  console.log('  [PASS] dialogue only = medium');
}

{
  assert.strictEqual(engagementScore(0, false), 'low');
  console.log('  [PASS] nothing = low');
}

// ---------------------------------------------------------------------------
// correlate
// ---------------------------------------------------------------------------

console.log('\n--- correlate ---');

{
  const result = correlate(null);
  assert.strictEqual(result.segments.length, 0);
  assert.strictEqual(result.summary.totalSegments, 0);
  console.log('  [PASS] null data returns empty');
}

{
  const result = correlate({ clicks: [], transcript: [], screenshots: [] });
  assert.strictEqual(result.segments.length, 0);
  console.log('  [PASS] empty arrays returns empty');
}

{
  const data = {
    clicks: [
      { timestamp: 1000, url: 'https://app.com/xdr/alerts', element: 'btn-xdr' },
      { timestamp: 5000, url: 'https://app.com/endpoint', element: 'btn-ep' },
    ],
    transcript: [
      { start: 0, end: 10000, text: 'Let me show you our XDR capabilities' },
    ],
    screenshots: [
      { timestamp: 800, url: 'shot1.png' },
      { timestamp: 1200, url: 'shot2.png' },
      { timestamp: 5500, url: 'shot3.png' },
    ],
  };

  const result = correlate(data, { segmentMs: 30000 });

  assert.strictEqual(result.segments.length, 1);
  const seg = result.segments[0];

  // Engagement: clicks + dialogue = high
  assert.strictEqual(seg.engagement_score, 'high');

  // Topics detected
  assert.ok(seg.topics.includes('XDR'));
  assert.ok(seg.topics.includes('Endpoint Security'));

  // Screenshot refs on clicks
  const click0 = seg.clicks[0];
  assert.ok(click0.screenshot_urls.includes('shot1.png'));
  assert.ok(click0.screenshot_urls.includes('shot2.png'));

  const click1 = seg.clicks[1];
  assert.ok(click1.screenshot_urls.includes('shot3.png'));

  // Segment-level screenshot_urls aggregated
  assert.ok(seg.screenshot_urls.length >= 2);

  // Transcript text present
  assert.ok(seg.transcript_text.includes('XDR capabilities'));

  // Summary
  assert.strictEqual(result.summary.totalSegments, 1);
  assert.ok(result.summary.topics.includes('XDR'));
  assert.ok(result.summary.scoreCounts.high >= 1);

  console.log('  [PASS] full correlation with clicks, transcript, screenshots');
}

// Multi-segment test
{
  const data = {
    clicks: [
      { timestamp: 0, url: 'https://app.com/ztsa', element: 'btn' },
    ],
    transcript: [
      { start: 35000, end: 55000, text: 'cloud security is important' },
    ],
    screenshots: [],
  };

  const result = correlate(data, { segmentMs: 30000 });

  // Should have at least 2 segments (0-30000 and 30000-60000)
  assert.ok(result.segments.length >= 2, `expected >=2 segments, got ${result.segments.length}`);

  // First segment: click only = medium
  assert.strictEqual(result.segments[0].engagement_score, 'medium');
  assert.ok(result.segments[0].topics.includes('ZTSA'));

  // Second segment: dialogue only = medium
  assert.strictEqual(result.segments[1].engagement_score, 'medium');
  assert.ok(result.segments[1].topics.includes('Cloud Security'));

  console.log('  [PASS] multi-segment with different engagement levels');
}

// Require test from task description
{
  const c = require('../lib/correlator');
  assert.strictEqual(typeof c.correlate, 'function');
  console.log('  [PASS] typeof correlate === function');
}

console.log('\nAll correlator tests passed.');
