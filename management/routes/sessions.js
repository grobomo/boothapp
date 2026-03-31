'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// Lazy-load S3 client
let s3Client = null;
function getS3() {
  if (!s3Client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return s3Client;
}

const BUCKET = process.env.S3_BUCKET || 'boothapp-sessions-752266476357';

async function writeS3Json(key, data) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await getS3().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  }));
}

async function deleteS3Key(key) {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  try {
    await getS3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (_) {
    // Ignore delete failures
  }
}

// GET /api/sessions
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { event_id } = req.query;
  let sessions;
  if (event_id) {
    sessions = db.prepare('SELECT * FROM sessions WHERE event_id = ? ORDER BY created_at DESC').all(
      parseInt(event_id, 10)
    );
  } else {
    sessions = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
  }

  sessions.forEach(s => {
    s.visitor_fields = JSON.parse(s.visitor_fields || '{}');
  });

  res.json({ sessions });
});

// POST /api/sessions/create
router.post('/create', async (req, res) => {
  const { event_id, demo_pc_id, visitor_name, visitor_company, visitor_title, visitor_fields } = req.body;

  if (!event_id) {
    return res.status(400).json({ error: 'event_id required' });
  }

  const db = getDb();
  const sessionId = uuidv4();
  const s3Prefix = `sessions/${sessionId}`;

  db.prepare(`
    INSERT INTO sessions (id, event_id, demo_pc_id, visitor_name, visitor_company, visitor_title, visitor_fields, status, s3_prefix)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    sessionId,
    parseInt(event_id, 10),
    demo_pc_id ? parseInt(demo_pc_id, 10) : null,
    visitor_name || null,
    visitor_company || null,
    visitor_title || null,
    JSON.stringify(visitor_fields || {}),
    s3Prefix
  );

  // Write metadata.json to S3
  try {
    await writeS3Json(`${s3Prefix}/metadata.json`, {
      session_id: sessionId,
      event_id: parseInt(event_id, 10),
      demo_pc_id: demo_pc_id || null,
      visitor_name: visitor_name || null,
      visitor_company: visitor_company || null,
      visitor_title: visitor_title || null,
      visitor_fields: visitor_fields || {},
      status: 'active',
      created_at: new Date().toISOString(),
    });

    // Write active-session.json
    await writeS3Json('active-session.json', {
      active: true,
      session_id: sessionId,
      event_id: parseInt(event_id, 10),
      demo_pc_id: demo_pc_id || null,
      stop_audio: false,
    });
  } catch (err) {
    console.error('Failed to write session to S3:', err.message);
    // Don't fail the request - session is in DB
  }

  res.status(201).json({
    session_id: sessionId,
    status: 'active',
    s3_prefix: s3Prefix,
  });
});

// POST /api/sessions/:id/stop-audio
router.post('/:id/stop-audio', async (req, res) => {
  const db = getDb();
  const sessionId = req.params.id;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  db.prepare('UPDATE sessions SET audio_opted_out = 1 WHERE id = ?').run(sessionId);

  // Update active-session.json with stop_audio flag
  try {
    await writeS3Json('active-session.json', {
      active: true,
      session_id: sessionId,
      event_id: session.event_id,
      stop_audio: true,
    });
  } catch (err) {
    console.error('Failed to update S3 stop-audio:', err.message);
  }

  res.json({ ok: true, audio_opted_out: true });
});

// POST /api/sessions/:id/end
router.post('/:id/end', async (req, res) => {
  const db = getDb();
  const sessionId = req.params.id;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  db.prepare("UPDATE sessions SET status = 'complete', ended_at = datetime('now') WHERE id = ?").run(sessionId);

  // Delete active-session.json from S3
  try {
    await deleteS3Key('active-session.json');
  } catch (err) {
    console.error('Failed to delete active-session.json:', err.message);
  }

  res.json({ ok: true, status: 'complete' });
});

// GET /api/sessions/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  session.visitor_fields = JSON.parse(session.visitor_fields || '{}');
  res.json({ session });
});

module.exports = router;
