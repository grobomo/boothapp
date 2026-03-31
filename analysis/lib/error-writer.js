'use strict';

const fs = require('fs');
const path = require('path');
const { classifyError } = require('./errors');

/**
 * Write a structured error.json to sessions/<id>/output/.
 * Creates the directory tree if it doesn't exist.
 *
 * @param {string} sessionsDir - base sessions directory
 * @param {string} sessionId   - session identifier
 * @param {string} stage       - pipeline stage that failed (e.g. 'download', 'transcribe', 'analyze')
 * @param {Error}  err         - the caught error
 */
function writeErrorJson(sessionsDir, sessionId, stage, err) {
  const classified = classifyError(err);
  const outputDir = path.join(sessionsDir, sessionId, 'output');

  fs.mkdirSync(outputDir, { recursive: true });

  const payload = {
    error: true,
    timestamp: new Date().toISOString(),
    sessionId,
    stage,
    type: classified.type,
    retryable: classified.retryable,
    message: classified.message,
    code: classified.code,
    detail: classified.detail,
    stack: err.stack || null,
  };

  const filePath = path.join(outputDir, 'error.json');
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
  return filePath;
}

module.exports = { writeErrorJson };
