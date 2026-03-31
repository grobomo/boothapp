'use strict';

const assert = require('assert');
const {
  renderSummaryHtml,
  buildAvatarHtml,
  buildVisitorCard,
  buildEngagementSection,
  buildTimelineSection,
} = require('../lib/render-report');

// ---------------------------------------------------------------------------
// buildAvatarHtml
// ---------------------------------------------------------------------------

console.log('--- buildAvatarHtml ---');

{
  const html = buildAvatarHtml('https://s3.example.com/sessions/abc/badge.jpg');
  assert.ok(html.includes('<img'), 'should contain img tag');
  assert.ok(html.includes('class="badge-photo"'), 'should have badge-photo class');
  assert.ok(html.includes('src="https://s3.example.com/sessions/abc/badge.jpg"'), 'should have correct src');
  assert.ok(html.includes('alt="Visitor badge photo"'), 'should have alt text');
  console.log('  [PASS] renders circular img when badgePhotoUrl provided');
}

{
  const html = buildAvatarHtml('https://example.com/photo?id=1&type="badge"');
  assert.ok(html.includes('&amp;'), 'should escape ampersand');
  assert.ok(html.includes('&quot;'), 'should escape quotes');
  console.log('  [PASS] escapes special characters in URL');
}

{
  const html = buildAvatarHtml(null);
  assert.ok(html.includes('class="badge-placeholder"'), 'should have placeholder class');
  assert.ok(html.includes('<svg'), 'should contain SVG');
  assert.ok(html.includes('<circle'), 'should contain circle (head)');
  assert.ok(html.includes('<ellipse'), 'should contain ellipse (body)');
  assert.ok(!html.includes('<img'), 'should NOT contain img tag');
  console.log('  [PASS] renders SVG placeholder when no URL');
}

{
  const html = buildAvatarHtml('');
  assert.ok(html.includes('class="badge-placeholder"'), 'empty string = placeholder');
  assert.ok(!html.includes('<img'), 'empty string should NOT render img');
  console.log('  [PASS] renders placeholder for empty string');
}

// ---------------------------------------------------------------------------
// buildVisitorCard
// ---------------------------------------------------------------------------

console.log('--- buildVisitorCard ---');

{
  const html = buildVisitorCard({
    name: 'Jane Doe',
    company: 'Acme Corp',
    visitDate: '2026-03-15',
    badgePhotoUrl: 'https://s3.example.com/badge.jpg',
  });
  assert.ok(html.includes('class="visitor-card"'), 'should have card class');
  assert.ok(html.includes('class="badge-photo"'), 'should have badge photo');
  assert.ok(html.includes('Jane Doe'), 'should show name');
  assert.ok(html.includes('Acme Corp'), 'should show company');
  assert.ok(html.includes('2026-03-15'), 'should show date');
  console.log('  [PASS] renders full card with badge photo');
}

{
  const html = buildVisitorCard({ name: 'Bob', company: 'TechCo' });
  assert.ok(html.includes('class="visitor-card"'), 'should have card class');
  assert.ok(html.includes('class="badge-placeholder"'), 'should have placeholder');
  assert.ok(!html.includes('<img'), 'should NOT have img');
  assert.ok(html.includes('Bob'), 'should show name');
  assert.ok(html.includes('TechCo'), 'should show company');
  console.log('  [PASS] renders placeholder when no badge photo');
}

{
  const html = buildVisitorCard(null);
  assert.ok(html.includes('Unknown Visitor'), 'null visitor = Unknown Visitor');
  assert.ok(html.includes('class="badge-placeholder"'), 'null visitor = placeholder');
  console.log('  [PASS] handles null visitor gracefully');
}

{
  const html = buildVisitorCard({ name: 'Alice' });
  assert.ok(html.includes('Alice'), 'should show name');
  assert.ok(!html.includes('visitor-company'), 'should omit company');
  assert.ok(!html.includes('visitor-date'), 'should omit date');
  console.log('  [PASS] omits company and date when not provided');
}

{
  const html = buildVisitorCard({ name: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'), 'should NOT contain raw script tag');
  assert.ok(html.includes('&lt;script&gt;'), 'should escape HTML');
  console.log('  [PASS] escapes HTML in visitor name');
}

// ---------------------------------------------------------------------------
// buildEngagementSection
// ---------------------------------------------------------------------------

console.log('--- buildEngagementSection ---');

{
  const html = buildEngagementSection({
    totalSegments: 5,
    topics: ['XDR', 'ZTSA'],
    avgEngagement: 'high',
  });
  assert.ok(html.includes('Engagement Summary'), 'should have heading');
  assert.ok(html.includes('<strong>5</strong>'), 'should show segment count');
  assert.ok(html.includes('engagement-high'), 'should show engagement level');
  assert.ok(html.includes('XDR'), 'should show topic');
  assert.ok(html.includes('ZTSA'), 'should show topic');
  console.log('  [PASS] renders engagement summary with topics');
}

{
  const html = buildEngagementSection(null);
  assert.ok(html.includes('Engagement Summary'), 'should have heading even with null');
  console.log('  [PASS] handles null summary');
}

// ---------------------------------------------------------------------------
// buildTimelineSection
// ---------------------------------------------------------------------------

console.log('--- buildTimelineSection ---');

{
  const html = buildTimelineSection([
    {
      engagement_score: 'high',
      topics: ['XDR'],
      clicks: [{ timestamp: 1000 }],
      transcript_text: 'Hello world',
    },
  ]);
  assert.ok(html.includes('<table>'), 'should have table');
  assert.ok(html.includes('engagement-high'), 'should show score');
  assert.ok(html.includes('Hello world'), 'should show transcript');
  console.log('  [PASS] renders timeline table');
}

{
  const result = buildTimelineSection([]);
  assert.strictEqual(result, '', 'empty segments = empty string');
  console.log('  [PASS] empty segments returns empty string');
}

{
  const result = buildTimelineSection(null);
  assert.strictEqual(result, '', 'null segments = empty string');
  console.log('  [PASS] null segments returns empty string');
}

// ---------------------------------------------------------------------------
// renderSummaryHtml — full document
// ---------------------------------------------------------------------------

console.log('--- renderSummaryHtml ---');

const sampleCorrelator = {
  segments: [
    {
      start: 0, end: 30000, engagement_score: 'high',
      topics: ['XDR'],
      clicks: [{ timestamp: 5000, url: '/xdr', element: 'btn' }],
      transcript_text: 'We discussed XDR capabilities.',
      screenshot_urls: [],
    },
    {
      start: 30000, end: 60000, engagement_score: 'low',
      topics: [], clicks: [], transcript_text: null, screenshot_urls: [],
    },
  ],
  summary: {
    totalSegments: 2, topics: ['XDR'], avgEngagement: 'medium',
    scoreCounts: { high: 1, medium: 0, low: 1 },
  },
};

{
  const html = renderSummaryHtml({
    correlator: sampleCorrelator,
    visitor: { name: 'Test User', company: 'TestCo', visitDate: '2026-03-31', badgePhotoUrl: 'badge.jpg' },
  });
  assert.ok(html.includes('<!DOCTYPE html>'), 'should be valid HTML doc');
  assert.ok(html.includes('</html>'), 'should close HTML');
  assert.ok(html.includes('<style>'), 'should have inline styles');
  assert.ok(html.includes('border-radius: 50%'), 'should have circular photo style');
  assert.ok(html.includes('object-fit: cover'), 'should have cover fit style');
  console.log('  [PASS] produces complete HTML document with circular styles');
}

{
  const html = renderSummaryHtml({
    correlator: sampleCorrelator,
    visitor: { name: 'Photo User', badgePhotoUrl: 'https://cdn.example.com/photo.jpg' },
  });
  assert.ok(html.includes('class="badge-photo"'), 'should have badge-photo class');
  assert.ok(html.includes('src="https://cdn.example.com/photo.jpg"'), 'should have correct URL');
  console.log('  [PASS] includes badge photo img when URL provided');
}

{
  const html = renderSummaryHtml({
    correlator: sampleCorrelator,
    visitor: { name: 'No Photo User' },
  });
  assert.ok(html.includes('class="badge-placeholder"'), 'should have placeholder');
  assert.ok(html.includes('<svg'), 'should have SVG');
  assert.ok(!html.includes('class="badge-photo"'), 'should NOT have badge-photo');
  console.log('  [PASS] includes placeholder when no badge photo');
}

{
  const html = renderSummaryHtml({ correlator: sampleCorrelator });
  assert.ok(html.includes('Engagement Summary'), 'should have engagement section');
  assert.ok(html.includes('Segments: <strong>2</strong>'), 'should show segment count');
  assert.ok(html.includes('engagement-medium'), 'should show avg engagement');
  console.log('  [PASS] renders engagement summary');
}

{
  const html = renderSummaryHtml({ correlator: sampleCorrelator });
  assert.ok(html.includes('<table>'), 'should have timeline table');
  assert.ok(html.includes('engagement-high'), 'should show high engagement');
  assert.ok(html.includes('We discussed XDR capabilities.'), 'should show transcript');
  console.log('  [PASS] renders timeline table');
}

{
  const html = renderSummaryHtml({});
  assert.ok(html.includes('<!DOCTYPE html>'), 'should produce valid doc');
  assert.ok(html.includes('Unknown Visitor'), 'should show default name');
  assert.ok(html.includes('class="badge-placeholder"'), 'should show placeholder');
  console.log('  [PASS] handles empty data gracefully');
}

{
  const html = renderSummaryHtml({ title: 'My Custom Report' });
  assert.ok(html.includes('<title>My Custom Report</title>'), 'should use custom title');
  console.log('  [PASS] uses custom title');
}

{
  const html = renderSummaryHtml({
    correlator: sampleCorrelator,
    visitor: { name: 'Test', badgePhotoUrl: 'photo.jpg' },
  });
  assert.ok(!/<link[^>]+href="http/.test(html), 'no external CSS links');
  assert.ok(!/<script[^>]+src="http/.test(html), 'no external JS scripts');
  console.log('  [PASS] has no external dependencies');
}

{
  const html = renderSummaryHtml({});
  assert.ok(html.includes('width: 100px'), 'should have 100px width');
  assert.ok(html.includes('height: 100px'), 'should have 100px height');
  console.log('  [PASS] CSS includes 100x100 sizing for avatar');
}

console.log('\nAll render-report tests passed!');
