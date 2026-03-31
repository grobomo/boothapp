'use strict';

// Pipeline status tracker — writes progress updates to S3
// so the presenter app can poll sessions/<id>/output/status.json
// and show a live progress bar during the demo.

const {
  S3Client,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { SSE_PARAMS } = require('../../infra/lib/s3-encryption');

const REGION = process.env.AWS_REGION || 'us-east-1';

// Stage definitions with expected progress percentages and
// typical durations (seconds) for time estimation.
const STAGES = {
  fetching:          { pct: 5,   typicalSeconds: 5  },
  correlating:       { pct: 20,  typicalSeconds: 3  },
  annotating:        { pct: 35,  typicalSeconds: 10 },
  analyzing:         { pct: 60,  typicalSeconds: 30 },
  generating_report: { pct: 85,  typicalSeconds: 10 },
  complete:          { pct: 100, typicalSeconds: 0  },
  error:             { pct: -1,  typicalSeconds: 0  },
};

/**
 * Create a status tracker for a pipeline run.
 *
 * @param {string} sessionId
 * @param {string} bucket
 * @returns {{ update: Function, complete: Function, fail: Function }}
 */
function createTracker(sessionId, bucket) {
  const startedAt = new Date().toISOString();
  const s3Key = `sessions/${sessionId}/output/status.json`;
  let client = null;

  function getClient() {
    if (!client) client = new S3Client({ region: REGION });
    return client;
  }

  /**
   * Write status.json to S3. Best-effort — failures are logged but
   * never block the pipeline.
   */
  async function writeStatus(payload) {
    try {
      await getClient().send(new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: JSON.stringify(payload, null, 2),
        ContentType: 'application/json',
        ...SSE_PARAMS,
      }));
    } catch (err) {
      console.error(`[status:${sessionId}] Failed to write status.json: ${err.message}`);
    }
  }

  /**
   * Update pipeline status to a new stage.
   *
   * @param {string} stage — one of the STAGES keys
   * @param {string} [message] — optional human-readable message
   */
  async function update(stage, message) {
    const stageInfo = STAGES[stage] || { pct: 0, typicalSeconds: 0 };
    const now = new Date();

    // Estimate completion: sum remaining typical durations
    let remainingSeconds = 0;
    const stageKeys = Object.keys(STAGES);
    let found = false;
    for (let i = 0; i < stageKeys.length; i++) {
      if (stageKeys[i] === stage) { found = true; continue; }
      if (found && stageKeys[i] !== 'error') {
        remainingSeconds += STAGES[stageKeys[i]].typicalSeconds;
      }
    }

    const estimatedCompletion = remainingSeconds > 0
      ? new Date(now.getTime() + remainingSeconds * 1000).toISOString()
      : null;

    const payload = {
      session_id: sessionId,
      stage: stage,
      progress_pct: stageInfo.pct,
      started_at: startedAt,
      updated_at: now.toISOString(),
      estimated_completion: estimatedCompletion,
      message: message || null,
    };

    await writeStatus(payload);
    return payload;
  }

  /** Mark pipeline as complete. */
  async function complete(message) {
    return update('complete', message || 'Pipeline finished');
  }

  /** Mark pipeline as failed. */
  async function fail(errorMessage) {
    const now = new Date().toISOString();
    const payload = {
      session_id: sessionId,
      stage: 'error',
      progress_pct: -1,
      started_at: startedAt,
      updated_at: now,
      estimated_completion: null,
      message: errorMessage || 'Pipeline failed',
    };
    await writeStatus(payload);
    return payload;
  }

  return { update, complete, fail };
}

module.exports = { createTracker, STAGES };
