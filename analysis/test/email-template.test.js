'use strict';

const assert = require('assert');
const {
  generateTemplate,
  renderPlainText,
  extractHighlights,
  buildTopicBlocks,
  TOPIC_CONTENT,
  ENGAGEMENT_TIERS,
} = require('../lib/email-template');

// ---------------------------------------------------------------------------
// Helper: build a correlator-style output for testing
// ---------------------------------------------------------------------------

function makeCorrelatorOutput(overrides) {
  const defaults = {
    segments: [
      {
        start: 0, end: 30000,
        engagement_score: 'high',
        topics: ['XDR'],
        clicks: [{ timestamp: 5000, url: '/xdr', element: 'button' }],
        transcript_text: 'We discussed how XDR correlates alerts across your entire environment.',
        screenshot_urls: [],
      },
      {
        start: 30000, end: 60000,
        engagement_score: 'medium',
        topics: ['Endpoint Security'],
        clicks: [],
        transcript_text: 'Brief mention of endpoint protection.',
        screenshot_urls: [],
      },
    ],
    summary: {
      totalSegments: 2,
      topics: ['XDR', 'Endpoint Security'],
      avgEngagement: 'high',
      scoreCounts: { high: 1, medium: 1, low: 0 },
    },
  };

  return {
    segments: overrides.segments || defaults.segments,
    summary: { ...defaults.summary, ...overrides.summary },
  };
}

// ---------------------------------------------------------------------------
// extractHighlights
// ---------------------------------------------------------------------------

console.log('--- extractHighlights ---');

{
  const segments = [
    { engagement_score: 'high', transcript_text: 'Deep XDR discussion here' },
    { engagement_score: 'low', transcript_text: 'Just browsing' },
    { engagement_score: 'high', transcript_text: 'Another deep topic' },
    { engagement_score: 'high', transcript_text: null },
  ];
  const highlights = extractHighlights(segments);
  assert.strictEqual(highlights.length, 2);
  assert.strictEqual(highlights[0], 'Deep XDR discussion here');
  assert.strictEqual(highlights[1], 'Another deep topic');
  console.log('  [PASS] extracts only high-engagement text segments');
}

{
  const long = 'x'.repeat(250);
  const segments = [{ engagement_score: 'high', transcript_text: long }];
  const highlights = extractHighlights(segments);
  assert.strictEqual(highlights[0].length, 200);
  assert.ok(highlights[0].endsWith('...'));
  console.log('  [PASS] truncates long snippets to 200 chars');
}

{
  const highlights = extractHighlights([]);
  assert.strictEqual(highlights.length, 0);
  console.log('  [PASS] empty segments returns empty highlights');
}

// ---------------------------------------------------------------------------
// buildTopicBlocks
// ---------------------------------------------------------------------------

console.log('\n--- buildTopicBlocks ---');

{
  const blocks = buildTopicBlocks(['XDR', 'ZTSA']);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].topic, 'XDR');
  assert.ok(blocks[0].blurb.length > 0);
  assert.ok(blocks[0].cta.length > 0);
  assert.ok(blocks[0].resource.startsWith('https://'));
  assert.strictEqual(blocks[1].topic, 'ZTSA');
  console.log('  [PASS] builds blocks for known topics');
}

{
  const blocks = buildTopicBlocks(['UnknownProduct', 'XDR']);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].topic, 'XDR');
  console.log('  [PASS] skips unknown topics');
}

{
  const blocks = buildTopicBlocks([]);
  assert.strictEqual(blocks.length, 0);
  console.log('  [PASS] empty topics returns empty blocks');
}

{
  const blocks = buildTopicBlocks(null);
  assert.strictEqual(blocks.length, 0);
  console.log('  [PASS] null topics returns empty blocks');
}

// ---------------------------------------------------------------------------
// generateTemplate - high engagement
// ---------------------------------------------------------------------------

console.log('\n--- generateTemplate (high engagement) ---');

{
  const data = makeCorrelatorOutput({ summary: { avgEngagement: 'high', topics: ['XDR', 'Endpoint Security'] } });
  const tmpl = generateTemplate(data, { name: 'Alice', company: 'Acme' });

  assert.strictEqual(tmpl.engagementTier, 'high');
  assert.strictEqual(tmpl.tone, 'technical');
  assert.ok(tmpl.greeting.includes('Alice'));
  assert.ok(tmpl.greeting.includes('in-depth conversation'));
  assert.strictEqual(tmpl.topicCount, 2);
  assert.ok(tmpl.subject.length > 0);

  // High engagement includes highlights
  const highlightSection = tmpl.bodySections.find((s) => s.type === 'highlights');
  assert.ok(highlightSection, 'high engagement should include highlights section');
  assert.ok(highlightSection.items.length > 0);

  console.log('  [PASS] high engagement template with visitor name');
}

// ---------------------------------------------------------------------------
// generateTemplate - medium engagement
// ---------------------------------------------------------------------------

console.log('\n--- generateTemplate (medium engagement) ---');

{
  const data = makeCorrelatorOutput({ summary: { avgEngagement: 'medium', topics: ['Cloud Security'] } });
  const tmpl = generateTemplate(data);

  assert.strictEqual(tmpl.engagementTier, 'medium');
  assert.strictEqual(tmpl.tone, 'balanced');
  assert.ok(tmpl.greeting.includes('there')); // no visitor name
  assert.ok(tmpl.greeting.includes('stopping by'));
  assert.strictEqual(tmpl.topicCount, 1);

  // Medium does NOT include highlights
  const highlightSection = tmpl.bodySections.find((s) => s.type === 'highlights');
  assert.strictEqual(highlightSection, undefined);

  console.log('  [PASS] medium engagement template without visitor name');
}

// ---------------------------------------------------------------------------
// generateTemplate - low engagement
// ---------------------------------------------------------------------------

console.log('\n--- generateTemplate (low engagement) ---');

{
  const data = makeCorrelatorOutput({
    segments: [{ engagement_score: 'low', topics: [], transcript_text: null, clicks: [] }],
    summary: { avgEngagement: 'low', topics: [] },
  });
  const tmpl = generateTemplate(data);

  assert.strictEqual(tmpl.engagementTier, 'low');
  assert.strictEqual(tmpl.tone, 'nurture');
  assert.strictEqual(tmpl.topicCount, 0);
  assert.ok(tmpl.subject.includes('Great meeting'));
  assert.ok(tmpl.closingCta.includes('trendmicro.com'));

  console.log('  [PASS] low engagement with no topics uses generic subject');
}

// ---------------------------------------------------------------------------
// generateTemplate - null/empty input
// ---------------------------------------------------------------------------

console.log('\n--- generateTemplate (edge cases) ---');

{
  const tmpl = generateTemplate(null);
  assert.strictEqual(tmpl.engagementTier, 'low');
  assert.strictEqual(tmpl.topicCount, 0);
  console.log('  [PASS] null input produces valid low-engagement template');
}

{
  const tmpl = generateTemplate({});
  assert.strictEqual(tmpl.engagementTier, 'low');
  console.log('  [PASS] empty object input produces valid template');
}

// ---------------------------------------------------------------------------
// generateTemplate - all five topics
// ---------------------------------------------------------------------------

console.log('\n--- generateTemplate (all topics) ---');

{
  const allTopics = Object.keys(TOPIC_CONTENT);
  const data = makeCorrelatorOutput({ summary: { avgEngagement: 'high', topics: allTopics } });
  const tmpl = generateTemplate(data);

  assert.strictEqual(tmpl.topicCount, allTopics.length);
  const topicSection = tmpl.bodySections.find((s) => s.type === 'topics');
  assert.strictEqual(topicSection.items.length, allTopics.length);

  for (const item of topicSection.items) {
    assert.ok(item.blurb.length > 0);
    assert.ok(item.resource.startsWith('https://'));
  }
  console.log(`  [PASS] all ${allTopics.length} topics generate valid blocks`);
}

// ---------------------------------------------------------------------------
// renderPlainText
// ---------------------------------------------------------------------------

console.log('\n--- renderPlainText ---');

{
  const data = makeCorrelatorOutput({ summary: { avgEngagement: 'high', topics: ['XDR'] } });
  const tmpl = generateTemplate(data, { name: 'Bob' });
  const text = renderPlainText(tmpl);

  assert.ok(text.includes('Hi Bob'));
  assert.ok(text.includes('XDR'));
  assert.ok(text.includes('Best regards'));
  assert.ok(text.includes('Trend Micro Team'));
  assert.ok(text.includes('From our conversation'));
  assert.ok(text.includes('Solutions we discussed'));
  console.log('  [PASS] renders complete plain text email');
}

{
  const data = makeCorrelatorOutput({
    segments: [],
    summary: { avgEngagement: 'low', topics: [] },
  });
  const tmpl = generateTemplate(data);
  const text = renderPlainText(tmpl);

  assert.ok(text.includes('Hi there'));
  assert.ok(text.includes('Best regards'));
  // No sections
  assert.ok(!text.includes('From our conversation'));
  assert.ok(!text.includes('Solutions we discussed'));
  console.log('  [PASS] renders minimal email for low engagement with no topics');
}

// ---------------------------------------------------------------------------
// ENGAGEMENT_TIERS coverage
// ---------------------------------------------------------------------------

console.log('\n--- ENGAGEMENT_TIERS coverage ---');

{
  for (const tier of ['high', 'medium', 'low']) {
    assert.ok(ENGAGEMENT_TIERS[tier]);
    assert.ok(ENGAGEMENT_TIERS[tier].greeting.length > 0);
    assert.ok(['technical', 'balanced', 'nurture'].includes(ENGAGEMENT_TIERS[tier].tone));
  }
  console.log('  [PASS] all three engagement tiers defined with greeting and tone');
}

console.log('\nAll email-template tests passed.');
