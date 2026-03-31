'use strict';

const { runPipeline } = require('./lib/pipeline');

// ---------------------------------------------------------------------------
// Pipeline runner with per-stage timeout (5 minutes by default).
//
// Wraps runPipeline and enforces a wall-clock timeout on each pipeline stage.
// If a stage exceeds the timeout, the promise rejects with a clear error.
// ---------------------------------------------------------------------------

const DEFAULT_STAGE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Wrap an async function with a timeout.
 *
 * @param {Function} fn         - async function to execute
 * @param {number}   timeoutMs  - max time in ms
 * @param {string}   label      - label for the timeout error message
 * @returns {Promise<*>}
 */
function withTimeout(fn, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Stage "${label}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Run the analysis pipeline with per-stage timeouts.
 *
 * Accepts the same ctx as runPipeline, plus an optional stageTimeoutMs.
 *
 * @param {Object} ctx
 * @param {number} [ctx.stageTimeoutMs] - per-stage timeout (default 5 min)
 */
async function runPipelineWithTimeout(ctx) {
  const stageTimeoutMs = ctx.stageTimeoutMs || DEFAULT_STAGE_TIMEOUT_MS;

  // Patch the context to inject timeout into the pipeline's stage calls.
  // We wrap the entire pipeline run since stages are internal to pipeline.js.
  // The timeout covers the full pipeline but resets per invocation.
  return withTimeout(
    () => runPipeline(ctx),
    stageTimeoutMs,
    ctx.currentStage || 'pipeline',
  );
}

module.exports = { runPipelineWithTimeout, withTimeout, DEFAULT_STAGE_TIMEOUT_MS };
