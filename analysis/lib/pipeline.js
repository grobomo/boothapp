'use strict';

const { classifyError } = require('./errors');
const { retry } = require('./retry');

/**
 * Run the 3-stage analysis pipeline for a single session.
 *
 * Stages: download -> transcribe -> analyze
 * Each S3/Bedrock call is wrapped with retry logic for transient failures.
 *
 * @param {Object}   ctx
 * @param {string}   ctx.sessionId
 * @param {string}   ctx.sessionsDir
 * @param {Object}   ctx.s3       - S3Client instance
 * @param {Object}   ctx.bedrock  - BedrockRuntimeClient instance
 * @param {Object}   ctx.config   - { bucket, modelId, maxRetries, baseDelayMs, maxDelayMs }
 * @param {Function} ctx.log
 * @returns {Promise<Object>} analysis result
 */
async function runPipeline(ctx) {
  const {
    sessionId,
    s3,
    bedrock,
    config = {},
    log = console.log,
  } = ctx;

  const retryOpts = {
    maxRetries: config.maxRetries ?? 3,
    baseDelayMs: config.baseDelayMs ?? 1000,
    maxDelayMs: config.maxDelayMs ?? 30000,
    shouldRetry: (err) => classifyError(err).retryable,
    onRetry: (err, attempt, delayMs) => {
      const classified = classifyError(err);
      log(`[pipeline] session=${sessionId} retry attempt=${attempt} type=${classified.type} delay=${delayMs}ms`);
    },
  };

  // Stage 1: Download recording from S3
  log(`[pipeline] session=${sessionId} stage=download`);
  const recording = await retry(
    () => downloadRecording(s3, config.bucket, sessionId),
    retryOpts,
  );

  // Stage 2: Transcribe audio
  log(`[pipeline] session=${sessionId} stage=transcribe`);
  const transcript = await retry(
    () => transcribeAudio(bedrock, config.modelId, recording),
    retryOpts,
  );

  // Stage 3: Analyze transcript
  log(`[pipeline] session=${sessionId} stage=analyze`);
  const analysis = await retry(
    () => analyzeTranscript(bedrock, config.modelId, transcript),
    retryOpts,
  );

  log(`[pipeline] session=${sessionId} complete`);
  return analysis;
}

// ---------------------------------------------------------------------------
// Stage implementations (thin wrappers around SDK calls)
// ---------------------------------------------------------------------------

async function downloadRecording(s3Client, bucket, sessionId) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const key = `sessions/${sessionId}/audio.webm`;
  const resp = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function transcribeAudio(bedrockClient, modelId, audioBuffer) {
  const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
  const resp = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: modelId || 'amazon.titan-tg1-large',
      contentType: 'application/json',
      body: JSON.stringify({
        inputDocument: { format: 'audio', source: { bytes: audioBuffer.toString('base64') } },
        task: 'transcribe',
      }),
    }),
  );
  return JSON.parse(Buffer.from(resp.body).toString()).transcript;
}

async function analyzeTranscript(bedrockClient, modelId, transcript) {
  const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
  const resp = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: modelId || 'anthropic.claude-3-sonnet-20240229-v1:0',
      contentType: 'application/json',
      body: JSON.stringify({
        prompt: `Analyze this booth conversation transcript and provide key insights:\n\n${transcript}`,
        max_tokens: 2048,
      }),
    }),
  );
  return JSON.parse(Buffer.from(resp.body).toString());
}

module.exports = { runPipeline };
