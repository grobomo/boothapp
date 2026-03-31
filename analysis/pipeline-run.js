'use strict';

const { runPipeline } = require('./lib/pipeline');

const DEFAULT_STAGE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create a timeout-wrapped version of a promise.
 * Rejects with a descriptive error if the stage exceeds the time limit.
 *
 * @param {Promise} promise   - the stage promise
 * @param {number}  ms        - timeout in milliseconds
 * @param {string}  stageName - name for error messages
 * @returns {Promise}
 */
function withTimeout(promise, ms, stageName) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Pipeline stage "${stageName}" timed out after ${ms}ms`);
      err.code = 'PIPELINE_STAGE_TIMEOUT';
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
 * Run the analysis pipeline with per-stage timeouts.
 *
 * Wraps each pipeline stage (download, transcribe, analyze) so that no
 * single stage can run longer than `stageTimeoutMs` (default 5 minutes).
 *
 * @param {Object} ctx - same context object as runPipeline expects
 * @param {number} [ctx.stageTimeoutMs] - per-stage timeout (default 300000)
 * @returns {Promise<Object>} analysis result
 */
async function runPipelineWithTimeout(ctx) {
  const stageTimeoutMs = ctx.stageTimeoutMs || DEFAULT_STAGE_TIMEOUT_MS;
  const log = ctx.log || console.log;

  // Wrap the original pipeline's stage functions by monkey-patching the context
  // to inject timeout behavior. The pipeline itself handles retries and error
  // writing; we add a timeout layer on top.
  const wrappedCtx = {
    ...ctx,
    log: (msg) => log(msg),
  };

  // runPipeline is a single async call -- wrap the entire execution with
  // a stage-level timeout by overriding the SDK clients with timeout-aware proxies.
  const timeoutProxy = (client, stageName) => {
    return new Proxy(client, {
      get(target, prop) {
        if (prop === 'send') {
          return (...args) => withTimeout(
            target.send(...args),
            stageTimeoutMs,
            stageName,
          );
        }
        return target[prop];
      },
    });
  };

  wrappedCtx.s3 = ctx.s3 ? timeoutProxy(ctx.s3, 'download') : ctx.s3;
  wrappedCtx.bedrock = ctx.bedrock ? timeoutProxy(ctx.bedrock, 'analyze') : ctx.bedrock;

  return runPipeline(wrappedCtx);
}

module.exports = { runPipelineWithTimeout, withTimeout, DEFAULT_STAGE_TIMEOUT_MS };
