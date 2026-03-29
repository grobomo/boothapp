'use strict';
/**
 * Session lifecycle orchestrator.
 *
 * Session states (stored in metadata.json):
 *   active     — session started, PC recording
 *   ended      — end signal sent, PC uploading
 *   analyzing  — set by ana-01 when analysis triggered
 *   complete   — set by ana-04 when report generated
 *
 * S3 command paths (polled by demo PCs):
 *   commands/<demo_pc>/start.json  — presence = start signal (PC polls every 1s)
 *   commands/<demo_pc>/end.json    — presence = end signal   (PC polls every 5s)
 */
const { putObject, getObject, objectExists } = require('./s3');
const { claimTenant } = require('./tenant-pool');

function generateSessionId() {
  // 8-char alphanumeric per DATA-CONTRACT (6–10 chars)
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

/**
 * Create a new session. Called by Android app when badge photo is taken.
 *
 * @param {object} params
 * @param {string} params.visitor_name
 * @param {string} [params.badge_photo]  — relative S3 key within session folder
 * @param {string} params.demo_pc        — unique ID of demo PC at this booth
 * @param {string} [params.se_name]
 * @param {boolean} [params.audio_consent]
 * @returns {{ session_id, metadata, tenant_available }}
 */
async function createSession({ visitor_name, badge_photo, demo_pc, se_name, audio_consent }) {
  if (!demo_pc) throw Object.assign(new Error('demo_pc is required'), { statusCode: 400 });

  const session_id = generateSessionId();
  const now = new Date().toISOString();

  // 1. Write metadata.json
  const metadata = {
    session_id,
    visitor_name: visitor_name || 'Unknown',
    badge_photo: badge_photo || null,
    started_at: now,
    ended_at: null,
    demo_pc,
    se_name: se_name || null,
    audio_consent: audio_consent !== false,
    status: 'active',
  };
  await putObject(`sessions/${session_id}/metadata.json`, metadata);

  // 2. Claim tenant and write tenant.json
  const tenant = await claimTenant(session_id);
  const tenantPayload = tenant || {
    session_id,
    status: 'queued',
    message: 'No tenant available — will be assigned when pool replenishes',
    created_at: now,
  };
  await putObject(`sessions/${session_id}/v1-tenant/tenant.json`, tenantPayload);

  // 3. Write start command for demo PC (presence = signal to start recording)
  await putObject(`commands/${demo_pc}/start.json`, {
    session_id,
    demo_pc,
    started_at: now,
    tenant_available: !!tenant,
  });

  return { session_id, metadata, tenant_available: !!tenant };
}

/**
 * End an active session. Called by Android app or demo PC operator.
 *
 * @param {string} session_id
 * @param {object} [opts]
 * @param {string} [opts.demo_pc]       — override if not in metadata
 * @param {boolean} [opts.upload_complete] — true if PC already uploaded
 */
async function endSession(session_id, opts = {}) {
  const metadata = await getSession(session_id); // throws 404 if missing

  if (metadata.status === 'ended' || metadata.status === 'complete') {
    return { session_id, status: metadata.status, message: 'Session already ended' };
  }

  const now = new Date().toISOString();
  const demo_pc = opts.demo_pc || metadata.demo_pc;

  // Update metadata status
  await putObject(`sessions/${session_id}/metadata.json`, {
    ...metadata,
    ended_at: now,
    status: 'ended',
    upload_complete: opts.upload_complete || false,
  });

  // Write end command for demo PC (presence = signal to stop + upload)
  await putObject(`commands/${demo_pc}/end.json`, {
    session_id,
    demo_pc,
    ended_at: now,
  });

  return { session_id, status: 'ended', ended_at: now };
}

/**
 * Get current session state (metadata + derived command flags).
 */
async function getSession(session_id) {
  let metadata;
  try {
    metadata = await getObject(`sessions/${session_id}/metadata.json`);
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchKey') {
      throw Object.assign(new Error(`Session ${session_id} not found`), { statusCode: 404 });
    }
    throw err;
  }

  const demo_pc = metadata.demo_pc;
  const [startSent, endSent] = await Promise.all([
    objectExists(`commands/${demo_pc}/start.json`),
    objectExists(`commands/${demo_pc}/end.json`),
  ]);

  return { ...metadata, commands: { start_sent: startSent, end_sent: endSent } };
}

module.exports = { createSession, endSession, getSession };
