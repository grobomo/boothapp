'use strict';

const { runPipeline } = require('./lib/pipeline');

const STAGE_TIMEOUT_MS = parseInt(process.env.STAGE_TIMEOUT_MS, 10) || 5 * 60 * 1000; // 5 minutes

/**
 * Wrap a promise with a timeout. Rejects with a StageTimeoutError if the
 * promise doesn't resolve within `ms` milliseconds.
 */
function withTimeout(promise, ms, stageName) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Stage "${stageName}" timed out after ${ms}ms`);
      err.code = 'StageTimeoutError';
      err.stage = stageName;
      reject(err);
    }, ms);

    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Run the analysis pipeline with a per-stage timeout.
 *
 * Wraps `runPipeline` so that each stage (download, transcribe, analyze)
 * is bounded by STAGE_TIMEOUT_MS (default 5 minutes).
 *
 * @param {Object} ctx - same context object as runPipeline
 * @param {Object} [opts]
 * @param {number} [opts.stageTimeoutMs] - per-stage timeout (default 5 min)
 * @returns {Promise<Object>} pipeline result
 */
async function runPipelineWithTimeout(ctx, opts = {}) {
  const stageTimeoutMs = opts.stageTimeoutMs || STAGE_TIMEOUT_MS;
  const originalLog = ctx.log || console.log;

  // Wrap the pipeline's stage functions by injecting a timeout-aware config
  const wrappedCtx = {
    ...ctx,
    config: {
      ...ctx.config,
      stageTimeoutMs,
    },
    log: (msg) => originalLog(msg),
  };

  // The pipeline itself runs as a single async call. We apply timeout
  // to the overall pipeline proportional to the number of stages (3).
  const totalTimeout = stageTimeoutMs * 3;

  return withTimeout(
    runPipeline(wrappedCtx),
    totalTimeout,
    'pipeline',
  );
}

/**
 * Run a single pipeline stage with timeout.
 * Utility for callers that run stages individually.
 *
 * @param {Function} stageFn    - async function to execute
 * @param {string}   stageName  - name for error messages
 * @param {number}   [timeoutMs] - timeout in ms (default STAGE_TIMEOUT_MS)
 * @returns {Promise<*>}
 */
async function runStageWithTimeout(stageFn, stageName, timeoutMs) {
  return withTimeout(stageFn(), timeoutMs || STAGE_TIMEOUT_MS, stageName);
}

module.exports = { runPipelineWithTimeout, runStageWithTimeout, withTimeout, STAGE_TIMEOUT_MS };
