'use strict';

/**
 * Three-stage analysis pipeline: transcribe -> correlate -> analyze (Bedrock).
 *
 * Each stage that calls AWS services is wrapped in withRetry for transient
 * error recovery.
 */

const { withRetry } = require('./errors');

/**
 * Stage 1: Transcribe audio to text.
 * In production this calls Amazon Transcribe; here we accept a transcriber function.
 */
async function transcribe(sessionData, { transcriber, logger, sessionId, sleepFn }) {
  return withRetry(
    () => transcriber(sessionData),
    'transcribe',
    { logger, sessionId, sleepFn }
  );
}

/**
 * Stage 2: Correlate clicks, transcript, and screenshots into a unified timeline.
 * This is local compute -- no AWS calls, so no retry wrapper needed.
 */
function correlate(sessionData, transcriptResult, { correlator }) {
  return correlator(sessionData, transcriptResult);
}

/**
 * Stage 3: Analyze via Amazon Bedrock (Claude).
 * This is the most likely stage to hit throttling.
 */
async function analyze(correlatedData, { bedrockClient, logger, sessionId, sleepFn }) {
  return withRetry(
    () => bedrockClient(correlatedData),
    'analyze',
    { logger, sessionId, sleepFn }
  );
}

/**
 * Run the full 3-stage pipeline for a session.
 *
 * @param {object} sessionData - Raw session data from S3
 * @param {object} deps - Injected dependencies
 * @param {Function} deps.transcriber - Audio transcription function
 * @param {Function} deps.correlator - Timeline correlation function
 * @param {Function} deps.bedrockClient - Bedrock analysis function
 * @param {Function} [deps.logger] - Log function
 * @param {string} [deps.sessionId] - Session ID for logging
 * @returns {Promise<object>} Analysis result
 */
async function runPipeline(sessionData, deps) {
  const logger = deps.logger || console.log;
  const sessionId = deps.sessionId || sessionData.session_id || 'unknown';
  const sleepFn = deps.sleepFn;

  logger(`[pipeline] session=${sessionId} stage=transcribe starting`);
  const transcript = await transcribe(sessionData, {
    transcriber: deps.transcriber,
    logger,
    sessionId,
    sleepFn,
  });

  logger(`[pipeline] session=${sessionId} stage=correlate starting`);
  const correlated = correlate(sessionData, transcript, {
    correlator: deps.correlator,
  });

  logger(`[pipeline] session=${sessionId} stage=analyze starting`);
  const result = await analyze(correlated, {
    bedrockClient: deps.bedrockClient,
    logger,
    sessionId,
    sleepFn,
  });

  logger(`[pipeline] session=${sessionId} complete`);
  return result;
}

module.exports = { runPipeline, transcribe, correlate, analyze };
