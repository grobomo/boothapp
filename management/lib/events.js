const express = require('express');
const { getDb } = require('./db');

// Public routes -- extension needs active event info for registration
function createPublicRouter() {
  const router = express.Router();

  router.get('/api/events', (req, res) => {
    const db = getDb();
    const events = db.prepare('SELECT * FROM events ORDER BY created_at DESC').all();
    res.json({ events });
  });

  router.get('/api/events/active', (req, res) => {
    const db = getDb();
    const event = db.prepare('SELECT * FROM events WHERE active = 1').get();
    if (!event) return res.status(404).json({ error: 'No active event' });
    res.json(event);
  });

  return router;
}

// Protected routes -- require auth (admin dashboard)
function createRouter() {
  const router = express.Router();

  router.post('/api/events', (req, res) => {
    const db = getDb();
    const { name, date, location } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const result = db.prepare('INSERT INTO events (name, date, location) VALUES (?, ?, ?)')
      .run(name, date || null, location || null);
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(event);
  });

  router.put('/api/events/:id', (req, res) => {
    const db = getDb();
    const { name, date, location } = req.body;
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    db.prepare('UPDATE events SET name = ?, date = ?, location = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(name || existing.name, date !== undefined ? date : existing.date, location !== undefined ? location : existing.location, req.params.id);
    const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    res.json(updated);
  });

  router.post('/api/events/:id/activate', (req, res) => {
    const db = getDb();
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    db.prepare('UPDATE events SET active = 0').run();
    db.prepare('UPDATE events SET active = 1, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
    res.json({ ...event, active: 1 });
  });

  router.delete('/api/events/:id', (req, res) => {
    const db = getDb();
    const result = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ deleted: true });
  });

  return router;
}

module.exports = { createRouter, createPublicRouter };
