// Pipeline trigger — invoked when a session is ready for analysis
// Currently a stub that logs and records the trigger.
// ana-02 (correlator), ana-03 (claude-analysis), and ana-04 (html-report)
// will be invoked from here once implemented.

const { spawn } = require('child_process');
const path = require('path');

// Trigger the full analysis pipeline for a completed session.
// Returns a promise that resolves when the pipeline step completes (or rejects on error).
async function triggerPipeline(sessionId, bucket) {
  const analysisDir = path.resolve(__dirname, '..');

  // Check for a runnable pipeline script (plugged in by ana-02+)
  const pipelineScript = path.join(analysisDir, 'pipeline-run.js');
  const fs = require('fs');

  if (fs.existsSync(pipelineScript)) {
    return runScript(pipelineScript, [sessionId, bucket]);
  }

  // Pipeline not yet implemented — log and return success so the watcher
  // marks the session claimed and moves on. Remove this branch when
  // pipeline-run.js is added by ana-02.
  console.log(`[pipeline] STUB — session ${sessionId} queued (pipeline not yet built)`);
  console.log(`[pipeline] When ana-02+ are implemented, add analysis/pipeline-run.js`);
  return { sessionId, status: 'queued-stub' };
}

const PIPELINE_TIMEOUT_MS = 300_000;

function runScript(script, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    const proc = spawn(process.execPath, [script, ...args], {
      env,
      stdio: 'inherit',
    });

    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        reject(new Error(`Pipeline timeout (${PIPELINE_TIMEOUT_MS}ms) for session ${args[0]}`));
      }
    }, PIPELINE_TIMEOUT_MS);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ sessionId: args[0], status: 'completed', exitCode: 0 });
      } else {
        reject(new Error(`Pipeline script exited with code ${code} for session ${args[0]}`));
      }
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

module.exports = { triggerPipeline };
