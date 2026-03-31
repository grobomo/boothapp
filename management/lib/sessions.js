const express = require('express');
const crypto = require('crypto');
const { getDb } = require('./db');
const s3 = require('./s3');

function generateSessionId() {
  // 6-char alphanumeric
  return crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
}

function createRouter() {
  const router = express.Router();

  // Create session
  router.post('/api/sessions', async (req, res) => {
    try {
      const db = getDb();
      const { visitor_name, visitor_company, visitor_title, demo_pc, se_name, audio_consent, event_id } = req.body;

      if (!visitor_name) return res.status(400).json({ error: 'visitor_name required' });

      // Use active event if not specified
      let evtId = event_id;
      if (!evtId) {
        const active = db.prepare('SELECT id FROM events WHERE active = 1').get();
        evtId = active?.id;
      }

      const sessionId = generateSessionId();
      const s3Prefix = `sessions/${sessionId}/`;

      // Write metadata to S3
      const metadata = {
        session_id: sessionId,
        visitor_name,
        visitor_company: visitor_company || null,
        visitor_title: visitor_title || null,
        badge_photo: 'badge.jpg',
        started_at: new Date().toISOString(),
        ended_at: null,
        demo_pc: demo_pc || 'booth-pc-1',
        se_name: se_name || null,
        audio_consent: audio_consent !== false,
        status: 'active',
        tags: []
      };
      await s3.putJson(`${s3Prefix}metadata.json`, metadata);

      // Write active-session marker
      await s3.putJson('active-session.json', {
        session_id: sessionId,
        demo_pc: demo_pc || 'booth-pc-1',
        visitor_name,
        started_at: metadata.started_at,
        stop_audio: false
      });

      // Store in DB
      db.prepare(`INSERT INTO sessions (id, event_id, visitor_name, visitor_company, visitor_title, demo_pc, se_name, audio_consent, status, s3_prefix)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
        .run(sessionId, evtId, visitor_name, visitor_company || null, visitor_title || null,
          demo_pc || 'booth-pc-1', se_name || null, audio_consent !== false ? 1 : 0, s3Prefix);

      res.status(201).json({
        session_id: sessionId,
        metadata,
        tenant_available: false
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // End session
  router.post('/api/sessions/:id/end', async (req, res) => {
    try {
      const db = getDb();
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const endedAt = new Date().toISOString();

      // Update metadata on S3
      try {
        const metadata = await s3.getJson(`${session.s3_prefix}metadata.json`);
        metadata.ended_at = endedAt;
        metadata.status = 'ended';
        await s3.putJson(`${session.s3_prefix}metadata.json`, metadata);
      } catch { /* metadata may not exist yet */ }

      // Delete active-session marker
      try { await s3.deleteObject('active-session.json'); } catch { /* ignore */ }

      // Update DB
      db.prepare('UPDATE sessions SET status = \'ended\', ended_at = ? WHERE id = ?').run(endedAt, req.params.id);

      res.json({
        session_id: req.params.id,
        status: 'ended',
        ended_at: endedAt,
        message: 'Session ended'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stop audio
  router.post('/api/sessions/:id/stop-audio', async (req, res) => {
    try {
      const db = getDb();
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      // Update active-session.json with stop_audio flag
      try {
        const activeSession = await s3.getJson('active-session.json');
        activeSession.stop_audio = true;
        await s3.putJson('active-session.json', activeSession);
      } catch { /* ignore if no active session */ }

      // Update DB
      db.prepare('UPDATE sessions SET audio_opted_out = 1 WHERE id = ?').run(req.params.id);

      res.json({ session_id: req.params.id, audio_opted_out: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // List sessions
  router.get('/api/sessions', (req, res) => {
    const db = getDb();
    const eventId = req.query.event_id;
    let sessions;
    if (eventId) {
      sessions = db.prepare('SELECT * FROM sessions WHERE event_id = ? ORDER BY started_at DESC').all(eventId);
    } else {
      sessions = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all();
    }
    res.json({ sessions });
  });

  // Get session detail
  router.get('/api/sessions/:id', (req, res) => {
    const db = getDb();
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  });

  // Import sessions from S3
  router.post('/api/sessions/import', async (req, res) => {
    try {
      const db = getDb();
      const keys = await s3.listKeys('sessions/');

      // Find session folders with package-manifest.json
      const manifests = keys.filter(k => k.endsWith('/package-manifest.json'));
      const imported = [];

      for (const manifestKey of manifests) {
        const sessionPrefix = manifestKey.replace('package-manifest.json', '');
        const sessionId = sessionPrefix.replace('sessions/', '').replace('/', '');

        // Skip already imported
        const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
        if (existing?.imported_at) continue;

        // Read metadata
        let metadata;
        try {
          metadata = await s3.getJson(`${sessionPrefix}metadata.json`);
        } catch {
          continue; // skip sessions without metadata
        }

        // Count screenshots
        const screenshotKeys = keys.filter(k => k.startsWith(`${sessionPrefix}screenshots/`));
        const hasAudio = keys.some(k => k.startsWith(`${sessionPrefix}audio/`));

        // Get active event
        const activeEvent = db.prepare('SELECT id FROM events WHERE active = 1').get();

        if (existing) {
          // Update existing record
          db.prepare(`UPDATE sessions SET screenshot_count = ?, has_audio = ?, package_key = ?, imported_at = datetime('now'), status = 'completed' WHERE id = ?`)
            .run(screenshotKeys.length, hasAudio ? 1 : 0, manifestKey, sessionId);
        } else {
          // Insert new
          db.prepare(`INSERT INTO sessions (id, event_id, visitor_name, visitor_company, demo_pc, se_name, audio_consent, status, s3_prefix, screenshot_count, has_audio, package_key, started_at, ended_at, imported_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, datetime('now'))`)
            .run(sessionId, activeEvent?.id, metadata.visitor_name, metadata.visitor_company,
              metadata.demo_pc, metadata.se_name, metadata.audio_consent ? 1 : 0,
              sessionPrefix, screenshotKeys.length, hasAudio ? 1 : 0, manifestKey,
              metadata.started_at, metadata.ended_at);
        }

        imported.push(sessionId);
      }

      res.json({ imported: imported.length, session_ids: imported });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRouter };
