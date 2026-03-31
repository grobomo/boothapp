'use strict';

const { classifyError, retryWithBackoff } = require('./errors');
const { writeErrorJson } = require('./error-writer');

/**
 * Run the analysis pipeline for a single session.
 *
 * Each step is wrapped with retry logic for transient failures.
 * On permanent failure the error is written to sessions/<id>/output/error.json
 * and the promise rejects.
 *
 * @param {Object} ctx
 * @param {string} ctx.sessionId
 * @param {string} ctx.sessionsDir  - base path for session data
 * @param {Object} ctx.s3           - S3Client instance
 * @param {Object} ctx.bedrock      - BedrockRuntimeClient instance
 * @param {Object} ctx.config       - pipeline config (bucket, modelId, etc.)
 * @param {Function} ctx.log        - logger function (default console.log)
 */
async function runPipeline(ctx) {
  const {
    sessionId,
    sessionsDir,
    s3,
    bedrock,
    config = {},
    log = console.log,
  } = ctx;

  const retryOpts = {
    maxRetries: config.maxRetries ?? 3,
    baseDelayMs: config.baseDelayMs ?? 1000,
    maxDelayMs: config.maxDelayMs ?? 30000,
    onRetry: (classified, attempt, delayMs) => {
      log(`[pipeline] session=${sessionId} retry attempt=${attempt} type=${classified.type} delay=${delayMs}ms`);
    },
  };

  let currentStage = 'download';
  try {
    // --- Stage 1: Download recording from S3 ---
    log(`[pipeline] session=${sessionId} stage=download`);
    const recording = await retryWithBackoff(
      () => downloadRecording(s3, config.bucket, sessionId),
      retryOpts,
    );

    // --- Stage 2: Transcribe audio ---
    currentStage = 'transcribe';
    log(`[pipeline] session=${sessionId} stage=transcribe`);
    const transcript = await retryWithBackoff(
      () => transcribeAudio(bedrock, config.modelId, recording),
      retryOpts,
    );

    // --- Stage 3: Analyze transcript ---
    currentStage = 'analyze';
    log(`[pipeline] session=${sessionId} stage=analyze`);
    const analysis = await retryWithBackoff(
      () => analyzeTranscript(bedrock, config.modelId, transcript),
      retryOpts,
    );

    log(`[pipeline] session=${sessionId} complete`);
    return analysis;
  } catch (err) {
    const classified = classifyError(err);
    log(`[pipeline] session=${sessionId} stage=${currentStage} FAILED type=${classified.type} retryable=${classified.retryable} msg=${classified.message}`);

    writeErrorJson(sessionsDir, sessionId, currentStage, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Pipeline stage implementations (thin wrappers around SDK calls)
// ---------------------------------------------------------------------------

async function downloadRecording(s3Client, bucket, sessionId) {
  const key = `recordings/${sessionId}/audio.webm`;
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
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
