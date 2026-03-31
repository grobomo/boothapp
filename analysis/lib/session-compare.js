'use strict';

// ---------------------------------------------------------------------------
// Session Comparison — uses Bedrock Claude to compare two booth sessions.
//
// Takes correlator output for two sessions and produces a structured
// comparison: similar interests, different products, engagement levels,
// and a combined follow-up strategy.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const COMPARISON_PROMPT_TEMPLATE = `You are analyzing two booth visitor sessions from a trade show. Compare them and return a JSON object with exactly these fields:

- similarInterests: array of strings — product topics or themes both visitors showed interest in
- differentProducts: array of objects [{sessionId, uniqueTopics: string[]}] — products/topics unique to each session
- engagementComparison: object {sessionId1: {level, clickCount, hasDialogue}, sessionId2: {level, clickCount, hasDialogue}, higherEngagement: sessionId} — which visitor was more engaged
- combinedFollowUp: object {strategy: string, sharedActions: string[], perSessionActions: [{sessionId, actions: string[]}]} — a unified follow-up plan

Session 1 (ID: {{SESSION_ID_1}}):
- Topics detected: {{TOPICS_1}}
- Average engagement: {{ENGAGEMENT_1}}
- Segment count: {{SEGMENT_COUNT_1}}
- Total clicks: {{CLICK_COUNT_1}}
- Has dialogue: {{HAS_DIALOGUE_1}}
- Transcript excerpts: {{EXCERPTS_1}}

Session 2 (ID: {{SESSION_ID_2}}):
- Topics detected: {{TOPICS_2}}
- Average engagement: {{ENGAGEMENT_2}}
- Segment count: {{SEGMENT_COUNT_2}}
- Total clicks: {{CLICK_COUNT_2}}
- Has dialogue: {{HAS_DIALOGUE_2}}
- Transcript excerpts: {{EXCERPTS_2}}

Return ONLY valid JSON, no markdown fences or explanation.`;

/**
 * Extract summary stats from correlator output for prompt injection.
 */
function extractSessionStats(correlatorOutput, sessionId) {
  const { segments = [], summary = {} } = correlatorOutput || {};
  const { topics = [], avgEngagement = 'low', scoreCounts = {} } = summary;

  let totalClicks = 0;
  let hasDialogue = false;
  const excerpts = [];

  for (const seg of segments) {
    totalClicks += (seg.clicks || []).length;
    if (seg.transcript_text) {
      hasDialogue = true;
      const text = seg.transcript_text;
      excerpts.push(text.length > 150 ? text.slice(0, 147) + '...' : text);
    }
  }

  return {
    sessionId,
    topics: topics.length > 0 ? topics.join(', ') : 'none detected',
    avgEngagement,
    segmentCount: segments.length,
    totalClicks,
    hasDialogue,
    excerpts: excerpts.slice(0, 3).join(' | ') || 'none',
  };
}

/**
 * Build the comparison prompt from two session stats.
 */
function buildPrompt(stats1, stats2) {
  return COMPARISON_PROMPT_TEMPLATE
    .replace('{{SESSION_ID_1}}', stats1.sessionId)
    .replace('{{TOPICS_1}}', stats1.topics)
    .replace('{{ENGAGEMENT_1}}', stats1.avgEngagement)
    .replace('{{SEGMENT_COUNT_1}}', String(stats1.segmentCount))
    .replace('{{CLICK_COUNT_1}}', String(stats1.totalClicks))
    .replace('{{HAS_DIALOGUE_1}}', String(stats1.hasDialogue))
    .replace('{{EXCERPTS_1}}', stats1.excerpts)
    .replace('{{SESSION_ID_2}}', stats2.sessionId)
    .replace('{{TOPICS_2}}', stats2.topics)
    .replace('{{ENGAGEMENT_2}}', stats2.avgEngagement)
    .replace('{{SEGMENT_COUNT_2}}', String(stats2.segmentCount))
    .replace('{{CLICK_COUNT_2}}', String(stats2.totalClicks))
    .replace('{{HAS_DIALOGUE_2}}', String(stats2.hasDialogue))
    .replace('{{EXCERPTS_2}}', stats2.excerpts);
}

/**
 * Parse Claude's JSON response, handling possible markdown fences.
 */
function parseResponse(text) {
  let cleaned = text.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

/**
 * Compare two sessions using Bedrock Claude.
 *
 * @param {Object} session1 - { sessionId, correlatorOutput }
 * @param {Object} session2 - { sessionId, correlatorOutput }
 * @param {Object} opts
 * @param {Object} opts.bedrock - BedrockRuntimeClient instance
 * @param {string} [opts.modelId] - model to use (default claude-3-sonnet)
 * @param {string} [opts.outputDir] - directory for output file (default 'output')
 * @returns {Promise<Object>} comparison result
 */
async function compareSessions(session1, session2, opts) {
  const { bedrock, modelId, outputDir } = opts || {};

  if (!bedrock) throw new Error('bedrock client is required');
  if (!session1 || !session1.sessionId) throw new Error('session1 with sessionId is required');
  if (!session2 || !session2.sessionId) throw new Error('session2 with sessionId is required');

  const stats1 = extractSessionStats(session1.correlatorOutput, session1.sessionId);
  const stats2 = extractSessionStats(session2.correlatorOutput, session2.sessionId);
  const prompt = buildPrompt(stats1, stats2);

  // Build the request payload. If @aws-sdk/client-bedrock-runtime is
  // available, use InvokeModelCommand; otherwise send a plain object
  // (allows tests to mock bedrock.send without the SDK installed).
  let request;
  try {
    const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
    request = new InvokeModelCommand({
      modelId: modelId || 'anthropic.claude-3-sonnet-20240229-v1:0',
      contentType: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (_) {
    request = {
      modelId: modelId || 'anthropic.claude-3-sonnet-20240229-v1:0',
      contentType: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    };
  }
  const resp = await bedrock.send(request);

  const respBody = JSON.parse(Buffer.from(resp.body).toString());
  const content = respBody.content && respBody.content[0] && respBody.content[0].text
    ? respBody.content[0].text
    : JSON.stringify(respBody);

  const comparison = parseResponse(content);

  // Add metadata
  const result = {
    comparedAt: new Date().toISOString(),
    session1Id: session1.sessionId,
    session2Id: session2.sessionId,
    session1Stats: stats1,
    session2Stats: stats2,
    comparison,
  };

  // Write output file
  if (outputDir !== false) {
    const outDir = outputDir || 'output';
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const filename = `comparison-${session1.sessionId}-${session2.sessionId}.json`;
    const outPath = path.join(outDir, filename);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    result.outputPath = outPath;
  }

  return result;
}

module.exports = {
  compareSessions,
  extractSessionStats,
  buildPrompt,
  parseResponse,
};
