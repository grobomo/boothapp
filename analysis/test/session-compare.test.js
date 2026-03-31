'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  compareSessions,
  extractSessionStats,
  buildPrompt,
  parseResponse,
} = require('../lib/session-compare');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SESSION_1 = {
  sessionId: 'sess-001',
  correlatorOutput: {
    segments: [
      {
        start: 0, end: 30000,
        engagement_score: 'high',
        topics: ['XDR', 'Endpoint Security'],
        clicks: [{ timestamp: 5000, url: '/xdr/demo' }],
        transcript_text: 'We discussed XDR and endpoint protection capabilities.',
        screenshot_urls: ['ss1.png'],
      },
      {
        start: 30000, end: 60000,
        engagement_score: 'medium',
        topics: ['XDR'],
        clicks: [],
        transcript_text: 'The visitor asked about integration with existing SIEM.',
        screenshot_urls: [],
      },
    ],
    summary: {
      totalSegments: 2,
      topics: ['XDR', 'Endpoint Security'],
      avgEngagement: 'high',
      scoreCounts: { high: 1, medium: 1, low: 0 },
    },
  },
};

const SESSION_2 = {
  sessionId: 'sess-002',
  correlatorOutput: {
    segments: [
      {
        start: 0, end: 30000,
        engagement_score: 'medium',
        topics: ['Cloud Security'],
        clicks: [
          { timestamp: 3000, url: '/cloud/overview' },
          { timestamp: 15000, url: '/cloud/containers' },
        ],
        transcript_text: 'Cloud security overview and container protection demo.',
        screenshot_urls: ['ss2.png'],
      },
      {
        start: 30000, end: 60000,
        engagement_score: 'low',
        topics: [],
        clicks: [],
        transcript_text: null,
        screenshot_urls: [],
      },
    ],
    summary: {
      totalSegments: 2,
      topics: ['Cloud Security'],
      avgEngagement: 'medium',
      scoreCounts: { high: 0, medium: 1, low: 1 },
    },
  },
};

// Mock Bedrock response
const MOCK_COMPARISON = {
  similarInterests: ['security operations visibility'],
  differentProducts: [
    { sessionId: 'sess-001', uniqueTopics: ['XDR', 'Endpoint Security'] },
    { sessionId: 'sess-002', uniqueTopics: ['Cloud Security'] },
  ],
  engagementComparison: {
    sessionId1: { level: 'high', clickCount: 1, hasDialogue: true },
    sessionId2: { level: 'medium', clickCount: 2, hasDialogue: true },
    higherEngagement: 'sess-001',
  },
  combinedFollowUp: {
    strategy: 'Both visitors are interested in security operations. Lead with Vision One platform story.',
    sharedActions: ['Send Vision One overview deck', 'Invite to webinar'],
    perSessionActions: [
      { sessionId: 'sess-001', actions: ['Schedule XDR deep-dive', 'Share EDR trial link'] },
      { sessionId: 'sess-002', actions: ['Send cloud security whitepaper', 'Demo container security'] },
    ],
  },
};

function createMockBedrock(responseObj) {
  return {
    send: async () => ({
      body: Buffer.from(JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify(responseObj) }],
      })),
    }),
  };
}

// ---------------------------------------------------------------------------
// extractSessionStats
// ---------------------------------------------------------------------------

console.log('--- extractSessionStats ---');

{
  const stats = extractSessionStats(SESSION_1.correlatorOutput, 'sess-001');
  assert.strictEqual(stats.sessionId, 'sess-001');
  assert.strictEqual(stats.topics, 'XDR, Endpoint Security');
  assert.strictEqual(stats.avgEngagement, 'high');
  assert.strictEqual(stats.segmentCount, 2);
  assert.strictEqual(stats.totalClicks, 1);
  assert.strictEqual(stats.hasDialogue, true);
  assert.ok(stats.excerpts.includes('XDR'));
  console.log('  [PASS] extracts stats from session with data');
}

{
  const stats = extractSessionStats(null, 'empty');
  assert.strictEqual(stats.sessionId, 'empty');
  assert.strictEqual(stats.topics, 'none detected');
  assert.strictEqual(stats.avgEngagement, 'low');
  assert.strictEqual(stats.segmentCount, 0);
  assert.strictEqual(stats.totalClicks, 0);
  assert.strictEqual(stats.hasDialogue, false);
  console.log('  [PASS] handles null correlator output');
}

{
  const stats = extractSessionStats({ segments: [], summary: {} }, 'no-data');
  assert.strictEqual(stats.segmentCount, 0);
  assert.strictEqual(stats.totalClicks, 0);
  console.log('  [PASS] handles empty segments');
}

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

console.log('\n--- buildPrompt ---');

{
  const stats1 = extractSessionStats(SESSION_1.correlatorOutput, 'sess-001');
  const stats2 = extractSessionStats(SESSION_2.correlatorOutput, 'sess-002');
  const prompt = buildPrompt(stats1, stats2);
  assert.ok(prompt.includes('sess-001'));
  assert.ok(prompt.includes('sess-002'));
  assert.ok(prompt.includes('XDR, Endpoint Security'));
  assert.ok(prompt.includes('Cloud Security'));
  assert.ok(prompt.includes('high'));
  assert.ok(prompt.includes('medium'));
  console.log('  [PASS] prompt contains both session details');
}

// ---------------------------------------------------------------------------
// parseResponse
// ---------------------------------------------------------------------------

console.log('\n--- parseResponse ---');

{
  const obj = parseResponse('{"key": "value"}');
  assert.deepStrictEqual(obj, { key: 'value' });
  console.log('  [PASS] parses plain JSON');
}

{
  const obj = parseResponse('```json\n{"key": "value"}\n```');
  assert.deepStrictEqual(obj, { key: 'value' });
  console.log('  [PASS] strips markdown fences');
}

{
  const obj = parseResponse('```\n{"key": "value"}\n```');
  assert.deepStrictEqual(obj, { key: 'value' });
  console.log('  [PASS] strips fences without language tag');
}

{
  try {
    parseResponse('not json');
    assert.fail('should throw');
  } catch (err) {
    assert.ok(err instanceof SyntaxError);
    console.log('  [PASS] throws on invalid JSON');
  }
}

// ---------------------------------------------------------------------------
// compareSessions (async tests)
// ---------------------------------------------------------------------------

async function runAsyncTests() {
  console.log('\n--- compareSessions ---');

  // Successful comparison
  {
    const tmpDir = path.join(__dirname, '_test_output_' + Date.now());
    try {
      const result = await compareSessions(SESSION_1, SESSION_2, {
        bedrock: createMockBedrock(MOCK_COMPARISON),
        outputDir: tmpDir,
      });

      assert.strictEqual(result.session1Id, 'sess-001');
      assert.strictEqual(result.session2Id, 'sess-002');
      assert.ok(result.comparedAt);
      assert.deepStrictEqual(result.comparison.similarInterests, ['security operations visibility']);
      assert.strictEqual(result.comparison.engagementComparison.higherEngagement, 'sess-001');
      assert.ok(result.comparison.combinedFollowUp.strategy);
      assert.ok(result.comparison.differentProducts.length === 2);

      // Verify file was written
      const outFile = path.join(tmpDir, 'comparison-sess-001-sess-002.json');
      assert.ok(fs.existsSync(outFile));
      const written = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      assert.strictEqual(written.session1Id, 'sess-001');
      console.log('  [PASS] produces comparison and writes output file');
    } finally {
      // Cleanup
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true });
      }
    }
  }

  // No output file when outputDir is false
  {
    const result = await compareSessions(SESSION_1, SESSION_2, {
      bedrock: createMockBedrock(MOCK_COMPARISON),
      outputDir: false,
    });
    assert.ok(!result.outputPath);
    assert.strictEqual(result.session1Id, 'sess-001');
    console.log('  [PASS] skips file write when outputDir=false');
  }

  // Missing bedrock client
  {
    try {
      await compareSessions(SESSION_1, SESSION_2, {});
      assert.fail('should throw');
    } catch (err) {
      assert.ok(err.message.includes('bedrock client is required'));
      console.log('  [PASS] throws when bedrock client missing');
    }
  }

  // Missing session1
  {
    try {
      await compareSessions(null, SESSION_2, { bedrock: createMockBedrock({}) });
      assert.fail('should throw');
    } catch (err) {
      assert.ok(err.message.includes('session1'));
      console.log('  [PASS] throws when session1 missing');
    }
  }

  // Missing session2
  {
    try {
      await compareSessions(SESSION_1, null, { bedrock: createMockBedrock({}) });
      assert.fail('should throw');
    } catch (err) {
      assert.ok(err.message.includes('session2'));
      console.log('  [PASS] throws when session2 missing');
    }
  }

  // Bedrock error propagates
  {
    const failBedrock = {
      send: async () => { throw new Error('Bedrock throttled'); },
    };
    try {
      await compareSessions(SESSION_1, SESSION_2, {
        bedrock: failBedrock,
        outputDir: false,
      });
      assert.fail('should throw');
    } catch (err) {
      assert.strictEqual(err.message, 'Bedrock throttled');
      console.log('  [PASS] propagates Bedrock errors');
    }
  }

  // Handles response with markdown fences
  {
    const fencedBedrock = {
      send: async () => ({
        body: Buffer.from(JSON.stringify({
          content: [{ type: 'text', text: '```json\n' + JSON.stringify(MOCK_COMPARISON) + '\n```' }],
        })),
      }),
    };
    const result = await compareSessions(SESSION_1, SESSION_2, {
      bedrock: fencedBedrock,
      outputDir: false,
    });
    assert.deepStrictEqual(result.comparison.similarInterests, ['security operations visibility']);
    console.log('  [PASS] handles markdown-fenced response');
  }

  console.log('\nAll session-compare tests passed!');
}

runAsyncTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
