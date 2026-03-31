'use strict';

/**
 * S3 session watcher -- polls for new sessions and runs the analysis pipeline.
 *
 * Looks for sessions with a `ready` trigger file, runs the 3-stage pipeline,
 * and writes results (or errors) to the session's output/ directory.
 *
 * Error recovery:
 *   - Transient Bedrock errors (ThrottlingException, ServiceUnavailableException)
 *     trigger exponential backoff retry: 3 attempts at 5s, 15s, 45s.
 *   - After all retries exhausted, the session is moved to a 'failed' queue
 *     (error.json written) and the watcher continues with other sessions.
 */

const { runPipeline } = require('./lib/pipeline');
const { buildErrorJson, writeErrorToS3 } = require('./lib/error-writer');

const POLL_INTERVAL_MS = 5000;

/**
 * Process a single session through the pipeline.
 * On failure after retries, writes error.json and returns false.
 *
 * @param {object} session - Session data from S3
 * @param {object} deps - Pipeline dependencies + S3 client
 * @param {object} deps.s3Client - AWS S3 client
 * @param {string} deps.bucket - S3 bucket name
 * @param {Function} deps.transcriber - Transcription function
 * @param {Function} deps.correlator - Correlation function
 * @param {Function} deps.bedrockClient - Bedrock analysis function
 * @param {Function} deps.resultWriter - Writes successful result to S3
 * @param {Function} [deps.logger] - Log function
 * @returns {Promise<boolean>} true if successful, false if failed
 */
async function processSession(session, deps) {
  const logger = deps.logger || console.log;
  const sessionId = session.session_id || 'unknown';

  try {
    const result = await runPipeline(session, {
      transcriber: deps.transcriber,
      correlator: deps.correlator,
      bedrockClient: deps.bedrockClient,
      logger,
      sessionId,
      sleepFn: deps.sleepFn,
    });

    await deps.resultWriter(deps.s3Client, deps.bucket, sessionId, result);
    logger(`[watcher] session=${sessionId} processed successfully`);
    return true;
  } catch (err) {
    logger(`[watcher] session=${sessionId} failed: ${err.code || err.name} - ${err.message}`);

    const errorData = buildErrorJson(err, sessionId);
    try {
      await writeErrorToS3(deps.s3Client, deps.bucket, sessionId, errorData);
      logger(`[watcher] session=${sessionId} moved to failed queue (error.json written)`);
    } catch (writeErr) {
      logger(`[watcher] session=${sessionId} CRITICAL: failed to write error.json: ${writeErr.message}`);
    }

    return false;
  }
}

/**
 * List sessions that have a `ready` trigger file but no output yet.
 *
 * @param {object} s3Client - AWS S3 client
 * @param {string} bucket - S3 bucket name
 * @param {Function} [logger] - Log function
 * @returns {Promise<string[]>} Array of session IDs ready for processing
 */
async function listReadySessions(s3Client, bucket, logger) {
  const log = logger || console.log;

  const readyResponse = await s3Client.listObjectsV2({
    Bucket: bucket,
    Prefix: 'sessions/',
    Delimiter: '/',
  }).promise();

  const prefixes = (readyResponse.CommonPrefixes || []).map(p => p.Prefix);
  const readySessions = [];

  for (const prefix of prefixes) {
    const sessionId = prefix.replace('sessions/', '').replace(/\/$/, '');

    // Check for ready file
    try {
      await s3Client.headObject({
        Bucket: bucket,
        Key: `${prefix}ready`,
      }).promise();
    } catch {
      continue; // No ready file
    }

    // Check if already processed (has result.json or error.json)
    let processed = false;
    for (const outFile of ['output/result.json', 'output/error.json']) {
      try {
        await s3Client.headObject({
          Bucket: bucket,
          Key: `${prefix}${outFile}`,
        }).promise();
        processed = true;
        break;
      } catch {
        // Not found, continue checking
      }
    }

    if (!processed) {
      readySessions.push(sessionId);
    }
  }

  if (readySessions.length > 0) {
    log(`[watcher] found ${readySessions.length} ready session(s): ${readySessions.join(', ')}`);
  }

  return readySessions;
}

/**
 * Fetch session data from S3.
 */
async function fetchSessionData(s3Client, bucket, sessionId) {
  // Try the consolidated JSON first (from demo-session.sh)
  try {
    const obj = await s3Client.getObject({
      Bucket: bucket,
      Key: `sessions/${sessionId}/session.json`,
    }).promise();
    return JSON.parse(obj.Body.toString('utf-8'));
  } catch {
    // Fall back to individual files per S3 data contract
  }

  const base = `sessions/${sessionId}/`;
  const session = { session_id: sessionId };

  // Badge data
  try {
    const badge = await s3Client.getObject({ Bucket: bucket, Key: `${base}badge.json` }).promise();
    session.visitor = JSON.parse(badge.Body.toString('utf-8'));
  } catch { /* optional */ }

  // Click data
  try {
    const clicks = await s3Client.getObject({ Bucket: bucket, Key: `${base}clicks.json` }).promise();
    session.clicks = JSON.parse(clicks.Body.toString('utf-8'));
  } catch { /* optional */ }

  return session;
}

/**
 * Run one poll cycle: list ready sessions, process each one.
 * Failures are isolated -- one session failing does not block others.
 */
async function pollOnce(deps) {
  const logger = deps.logger || console.log;
  const sessions = await listReadySessions(deps.s3Client, deps.bucket, logger);

  const results = { processed: 0, failed: 0 };

  for (const sessionId of sessions) {
    try {
      const sessionData = await fetchSessionData(deps.s3Client, deps.bucket, sessionId);
      const success = await processSession(sessionData, { ...deps, logger });
      if (success) {
        results.processed++;
      } else {
        results.failed++;
      }
    } catch (err) {
      logger(`[watcher] session=${sessionId} unexpected error: ${err.message}`);
      results.failed++;
    }
  }

  return results;
}

/**
 * Start the watcher loop. Polls S3 every POLL_INTERVAL_MS.
 *
 * @param {object} deps - All dependencies (s3Client, bucket, pipeline functions)
 * @returns {{ stop: Function }} Control handle to stop the watcher
 */
function startWatcher(deps) {
  const logger = deps.logger || console.log;
  let running = true;
  let timeoutId = null;

  logger('[watcher] starting -- polling every ' + (POLL_INTERVAL_MS / 1000) + 's');

  async function tick() {
    if (!running) return;

    try {
      await pollOnce(deps);
    } catch (err) {
      logger(`[watcher] poll error: ${err.message}`);
    }

    if (running) {
      timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
    }
  }

  tick();

  return {
    stop() {
      running = false;
      if (timeoutId) clearTimeout(timeoutId);
      logger('[watcher] stopped');
    },
  };
}

module.exports = {
  processSession,
  listReadySessions,
  fetchSessionData,
  pollOnce,
  startWatcher,
  POLL_INTERVAL_MS,
};
