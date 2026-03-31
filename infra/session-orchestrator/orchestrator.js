'use strict';
/**
 * Session lifecycle orchestrator.
 *
 * Session states (stored in metadata.json + state.json):
 *   active      — session created, waiting for demo PC
 *   recording   — audio capture started on demo PC
 *   ended       — end signal sent, PC uploading
 *   processing  — upload done, analysis pending
 *   analyzed    — AI output ready
 *   reviewed    — SE approved the summary
 *   sent        — follow-up delivered to visitor
 *
 * State transitions are enforced — only valid edges allowed.
 * Each transition writes sessions/<id>/state.json with full history.
 *
 * S3 command paths (polled by demo PCs):
 *   commands/<demo_pc>/start.json  — presence = start signal (PC polls every 1s)
 *   commands/<demo_pc>/end.json    — presence = end signal   (PC polls every 5s)
 */
const { putObject, getObject, objectExists, deleteObject, listPrefixes } = require('./s3');
const { claimTenant } = require('./tenant-pool');

// ── Input validation ───────────────────────────────────────────────────────

const SESSION_ID_RE = /^[A-Z0-9]{1,20}$/;
const DEMO_PC_RE = /^[a-zA-Z0-9_-]{1,50}$/;

function validateSessionId(session_id) {
  if (!session_id || typeof session_id !== 'string' || !SESSION_ID_RE.test(session_id)) {
    throw Object.assign(
      new Error(`Invalid session_id: must be 1-20 uppercase alphanumeric characters`),
      { statusCode: 400 }
    );
  }
}

function validateDemoPc(demo_pc) {
  if (!demo_pc || typeof demo_pc !== 'string' || !DEMO_PC_RE.test(demo_pc)) {
    throw Object.assign(
      new Error(`Invalid demo_pc: must be 1-50 alphanumeric, underscore, or hyphen characters`),
      { statusCode: 400 }
    );
  }
}

// ── State machine definition ───────────────────────────────────────────────

const VALID_STATES = ['active', 'recording', 'ended', 'processing', 'analyzed', 'reviewed', 'sent'];

const TRANSITIONS = {
  active:     ['recording', 'ended'],   // can skip recording if audio not used
  recording:  ['ended'],
  ended:      ['processing'],
  processing: ['analyzed'],
  analyzed:   ['reviewed'],
  reviewed:   ['sent'],
  sent:       [],                        // terminal state
};

/**
 * Transition a session to a new state. Validates the transition is allowed,
 * updates metadata.json status, and writes state.json with full history.
 *
 * @param {string} session_id
 * @param {string} target_state
 * @param {object} [context]  — optional context stored with the transition
 * @returns {{ session_id, previous_state, state, transitioned_at }}
 */
async function transitionState(session_id, target_state, context = {}) {
  validateSessionId(session_id);
  if (!VALID_STATES.includes(target_state)) {
    throw Object.assign(
      new Error(`Invalid state: ${target_state}. Valid: ${VALID_STATES.join(', ')}`),
      { statusCode: 400 }
    );
  }

  const metadata = await getSession(session_id);
  const current = metadata.status;

  const allowed = TRANSITIONS[current];
  if (!allowed || !allowed.includes(target_state)) {
    throw Object.assign(
      new Error(`Cannot transition from '${current}' to '${target_state}'. Allowed: ${(allowed || []).join(', ') || 'none (terminal state)'}`),
      { statusCode: 409 }
    );
  }

  const now = new Date().toISOString();

  // Load existing state.json or initialize
  let stateDoc;
  try {
    stateDoc = await getObject(`sessions/${session_id}/state.json`);
  } catch (_) {
    stateDoc = { session_id, current_state: current, history: [] };
  }

  // Append transition to history
  stateDoc.history.push({
    from: current,
    to: target_state,
    at: now,
    context: Object.keys(context).length > 0 ? context : undefined,
  });
  stateDoc.current_state = target_state;
  stateDoc.updated_at = now;

  // Write state.json
  await putObject(`sessions/${session_id}/state.json`, stateDoc);

  // Update metadata.json status to stay in sync
  const { commands, ...metaWithoutDerived } = metadata;
  await putObject(`sessions/${session_id}/metadata.json`, {
    ...metaWithoutDerived,
    status: target_state,
  });

  return { session_id, previous_state: current, state: target_state, transitioned_at: now };
}

/**
 * Get the full state document for a session (current state + transition history).
 */
async function getSessionState(session_id) {
  validateSessionId(session_id);
  // Verify session exists
  const metadata = await getSession(session_id);

  try {
    return await getObject(`sessions/${session_id}/state.json`);
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchKey') {
      // No state.json yet — return current state from metadata
      return { session_id, current_state: metadata.status, history: [] };
    }
    throw err;
  }
}

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
  validateDemoPc(demo_pc);

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

  // 1b. Write initial state.json
  await putObject(`sessions/${session_id}/state.json`, {
    session_id,
    current_state: 'active',
    updated_at: now,
    history: [{ from: null, to: 'active', at: now }],
  });

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

  // 4. Publish active-session.json at bucket root (polled by Chrome extension every 2s)
  await putObject('active-session.json', {
    session_id,
    active: true,
    started_at: now,
    visitor_name: visitor_name || 'Unknown',
    stop_audio: false,
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
  validateSessionId(session_id);
  const metadata = await getSession(session_id); // throws 404 if missing

  if (['ended', 'processing', 'analyzed', 'reviewed', 'sent'].includes(metadata.status)) {
    return { session_id, status: metadata.status, message: 'Session already ended' };
  }

  const now = new Date().toISOString();
  const demo_pc = opts.demo_pc || metadata.demo_pc;
  validateDemoPc(demo_pc);

  // Signal Chrome extension to stop audio before ending session
  await putObject('active-session.json', {
    session_id,
    active: true,
    stop_audio: true,
  });

  // Update metadata status (strip derived 'commands' field)
  const { commands, ...metaClean } = metadata;
  await putObject(`sessions/${session_id}/metadata.json`, {
    ...metaClean,
    ended_at: now,
    status: 'ended',
    upload_complete: opts.upload_complete || false,
  });

  // Write state.json transition
  let stateDoc;
  try {
    stateDoc = await getObject(`sessions/${session_id}/state.json`);
  } catch (_) {
    stateDoc = { session_id, current_state: metadata.status, history: [] };
  }
  stateDoc.history.push({ from: metadata.status, to: 'ended', at: now });
  stateDoc.current_state = 'ended';
  stateDoc.updated_at = now;
  await putObject(`sessions/${session_id}/state.json`, stateDoc);

  // Write end command for demo PC (presence = signal to stop + upload)
  await putObject(`commands/${demo_pc}/end.json`, {
    session_id,
    demo_pc,
    ended_at: now,
  });

  // Remove active-session.json so Chrome extension detects session end
  await deleteObject('active-session.json');

  return { session_id, status: 'ended', ended_at: now };
}

/**
 * Get current session state (metadata + derived command flags).
 */
async function getSession(session_id) {
  validateSessionId(session_id);
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

/**
 * List all sessions with metadata and analysis status.
 * Returns an array of session objects with: session_id, visitor_name, status,
 * created_at, has_analysis, se_name, started_at, ended_at.
 */
async function listSessions() {
  const prefixes = await listPrefixes('sessions/', '/');
  const sessionIds = prefixes
    .map(p => p.replace('sessions/', '').replace(/\/$/, ''))
    .filter(Boolean);

  const results = await Promise.all(sessionIds.map(async (sid) => {
    let meta = {};
    try {
      meta = await getObject(`sessions/${sid}/metadata.json`);
    } catch (_) {}

    const has_analysis = await objectExists(`sessions/${sid}/output/summary.json`);

    return {
      session_id: sid,
      visitor_name: meta.visitor_name || 'Unknown',
      status: meta.status || (meta.ended_at ? 'ended' : meta.started_at ? 'active' : 'unknown'),
      created_at: meta.started_at || meta.created_at || null,
      has_analysis,
      se_name: meta.se_name || null,
      started_at: meta.started_at || null,
      ended_at: meta.ended_at || null,
      visitor_company: meta.visitor_company || null,
      click_count: meta.click_count != null ? meta.click_count : null,
    };
  }));

  return results;
}

module.exports = {
  createSession, endSession, getSession, listSessions,
  transitionState, getSessionState,
  validateSessionId, validateDemoPc,
  VALID_STATES, TRANSITIONS,
};
