'use strict';

const { runPipeline } = require('./lib/pipeline');

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Run the analysis pipeline with a hard timeout per session.
 * Rejects with PIPELINE_TIMEOUT if the session exceeds the limit.
 *
 * @param {Object} ctx            - pipeline context (see pipeline.js)
 * @param {number} [timeoutMs]    - override timeout (default 10 minutes)
 * @returns {Promise<Object>}
 */
function runPipelineWithTimeout(ctx, timeoutMs) {
  const ms = timeoutMs || SESSION_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(
        `Session "${ctx.sessionId}" timed out after ${ms}ms (${Math.round(ms / 60000)} min)`,
      );
      err.code = 'PIPELINE_TIMEOUT';
      err.sessionId = ctx.sessionId;
      reject(err);
    }, ms);

    runPipeline(ctx).then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

module.exports = { runPipelineWithTimeout, SESSION_TIMEOUT_MS };
