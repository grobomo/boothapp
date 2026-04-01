const express = require('express');
const { getDb } = require('./db');

// Public routes -- extension calls these without auth
function createPublicRouter() {
  const router = express.Router();

  // Register a demo PC (extension calls this at setup)
  router.post('/api/demo-pcs', (req, res) => {
    const db = getDb();
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    let eventId = req.body.event_id;
    if (!eventId) {
      const active = db.prepare('SELECT id FROM events WHERE active = 1').get();
      eventId = active?.id;
    }
    if (!eventId) return res.status(400).json({ error: 'No event_id provided and no active event' });

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Upsert: return existing if PC with same name exists for this event
    const existing = db.prepare('SELECT * FROM demo_pcs WHERE name = ? AND event_id = ?').get(name, eventId);
    if (existing) return res.json(existing);

    const result = db.prepare('INSERT INTO demo_pcs (name, event_id) VALUES (?, ?)').run(name, eventId);
    const pc = db.prepare('SELECT * FROM demo_pcs WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(pc);
  });

  // Get QR pairing payload for a demo PC
  router.get('/api/demo-pcs/:id/qr-payload', (req, res) => {
    const db = getDb();
    const pc = db.prepare('SELECT dp.*, e.name as event_name, e.badge_profile FROM demo_pcs dp JOIN events e ON dp.event_id = e.id WHERE dp.id = ?').get(req.params.id);
    if (!pc) return res.status(404).json({ error: 'Demo PC not found' });

    let badgeFields = ['name', 'company', 'title'];
    if (pc.badge_profile) {
      try {
        const profile = JSON.parse(pc.badge_profile);
        if (profile.field_mappings) {
          badgeFields = profile.field_mappings.map(f => f.field_type);
        }
      } catch { /* use defaults */ }
    }

    const managementUrl = process.env.MANAGEMENT_URL || 'https://caseyapp.trendcyberrange.com';
    res.json({
      type: 'caseyapp-pair',
      v: 2,
      managementUrl,
      eventId: pc.event_id,
      demoPcId: pc.name,
      badgeFields,
      eventName: pc.event_name
    });
  });

  return router;
}

// Protected routes -- require auth (admin dashboard)
function createRouter() {
  const router = express.Router();

  // List demo PCs for an event
  router.get('/api/events/:eventId/demo-pcs', (req, res) => {
    const db = getDb();
    const pcs = db.prepare('SELECT * FROM demo_pcs WHERE event_id = ? ORDER BY name').all(req.params.eventId);
    res.json({ demo_pcs: pcs });
  });

  // Delete a demo PC
  router.delete('/api/demo-pcs/:id', (req, res) => {
    const db = getDb();
    const result = db.prepare('DELETE FROM demo_pcs WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Demo PC not found' });
    res.json({ deleted: true });
  });

  return router;
}

module.exports = { createRouter, createPublicRouter };
