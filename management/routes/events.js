'use strict';

const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// GET /api/events
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const events = db.prepare(`
    SELECT e.*, bp.name as badge_profile_name
    FROM events e
    LEFT JOIN badge_profiles bp ON e.badge_profile_id = bp.id
    ORDER BY e.created_at DESC
  `).all();
  res.json({ events });
});

// POST /api/events
router.post('/', requireAuth, (req, res) => {
  const { name, date, location } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Event name is required' });
  }

  const db = getDb();
  const result = db.prepare(
    'INSERT INTO events (name, date, location) VALUES (?, ?, ?)'
  ).run(name, date || null, location || null);

  res.status(201).json({
    id: result.lastInsertRowid,
    name,
    date,
    location,
    active: 0,
  });
});

// PUT /api/events/:id
router.put('/:id', requireAuth, (req, res) => {
  const { name, date, location } = req.body;
  const db = getDb();
  db.prepare('UPDATE events SET name = ?, date = ?, location = ? WHERE id = ?').run(
    name, date || null, location || null, parseInt(req.params.id, 10)
  );
  res.json({ ok: true });
});

// POST /api/events/:id/activate
router.post('/:id/activate', requireAuth, (req, res) => {
  const db = getDb();
  const eventId = parseInt(req.params.id, 10);

  // Deactivate all, then activate this one
  db.prepare('UPDATE events SET active = 0').run();
  db.prepare('UPDATE events SET active = 1 WHERE id = ?').run(eventId);

  res.json({ ok: true, active_event_id: eventId });
});

// GET /api/events/active
router.get('/active', (req, res) => {
  const db = getDb();
  const event = db.prepare('SELECT * FROM events WHERE active = 1').get();
  if (!event) {
    return res.status(404).json({ error: 'No active event' });
  }
  res.json({ event });
});

// DELETE /api/events/:id (cascades dependent records)
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const eventId = parseInt(req.params.id, 10);

  const sessionIds = db.prepare('SELECT id FROM sessions WHERE event_id = ?').all(eventId).map(r => r.id);
  for (const sid of sessionIds) {
    db.prepare('DELETE FROM contact_matches WHERE session_id = ?').run(sid);
  }
  db.prepare('DELETE FROM sessions WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM contacts WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM demo_pcs WHERE event_id = ?').run(eventId);
  db.prepare('UPDATE events SET badge_profile_id = NULL WHERE id = ?').run(eventId);
  db.prepare('DELETE FROM badge_profiles WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM events WHERE id = ?').run(eventId);

  res.json({ ok: true });
});

module.exports = router;
