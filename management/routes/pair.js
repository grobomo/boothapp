'use strict';

const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// POST /api/pair - Mobile app pairs with a demo PC after scanning QR
// No auth required (mobile app uses QR payload to identify itself)
router.post('/', (req, res) => {
  const { event_id, demo_pc_id, device_id, device_name } = req.body;

  if (!event_id || !demo_pc_id || !device_id) {
    return res.status(400).json({ error: 'event_id, demo_pc_id, and device_id required' });
  }

  const db = getDb();

  // Verify event exists
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(parseInt(event_id, 10));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // Verify demo PC exists
  const pc = db.prepare('SELECT * FROM demo_pcs WHERE id = ?').get(parseInt(demo_pc_id, 10));
  if (!pc) {
    return res.status(404).json({ error: 'Demo PC not found' });
  }

  // Upsert pairing -- one device per demo PC at a time
  const existing = db.prepare('SELECT * FROM pairings WHERE demo_pc_id = ?').get(parseInt(demo_pc_id, 10));
  if (existing) {
    db.prepare(
      "UPDATE pairings SET device_id = ?, device_name = ?, paired_at = datetime('now') WHERE demo_pc_id = ?"
    ).run(device_id, device_name || 'Unknown', parseInt(demo_pc_id, 10));
  } else {
    db.prepare(
      'INSERT INTO pairings (event_id, demo_pc_id, device_id, device_name) VALUES (?, ?, ?, ?)'
    ).run(parseInt(event_id, 10), parseInt(demo_pc_id, 10), device_id, device_name || 'Unknown');
  }

  res.status(200).json({
    paired: true,
    event_id: parseInt(event_id, 10),
    demo_pc_id: parseInt(demo_pc_id, 10),
    device_id,
    event_name: event.name,
  });
});

// GET /api/pair/status/:demoPcId - Extension polls for paired mobile device
router.get('/status/:demoPcId', (req, res) => {
  const db = getDb();
  const demoPcId = parseInt(req.params.demoPcId, 10);

  const pairing = db.prepare(
    'SELECT * FROM pairings WHERE demo_pc_id = ?'
  ).get(demoPcId);

  if (!pairing) {
    return res.json({ paired: false });
  }

  res.json({
    paired: true,
    device_id: pairing.device_id,
    device_name: pairing.device_name,
    paired_at: pairing.paired_at,
  });
});

// DELETE /api/pair/:demoPcId - Unpair a device from a demo PC
router.delete('/:demoPcId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM pairings WHERE demo_pc_id = ?').run(parseInt(req.params.demoPcId, 10));
  res.json({ ok: true });
});

module.exports = router;
