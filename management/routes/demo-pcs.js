'use strict';

const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// GET /api/demo-pcs
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { event_id } = req.query;
  let pcs;
  if (event_id) {
    pcs = db.prepare('SELECT * FROM demo_pcs WHERE event_id = ? ORDER BY name').all(parseInt(event_id, 10));
  } else {
    pcs = db.prepare('SELECT * FROM demo_pcs ORDER BY name').all();
  }
  res.json({ demo_pcs: pcs });
});

// POST /api/demo-pcs
router.post('/', requireAuth, (req, res) => {
  const { name, event_id } = req.body;
  if (!name || !event_id) {
    return res.status(400).json({ error: 'Name and event_id required' });
  }

  const db = getDb();
  const result = db.prepare('INSERT INTO demo_pcs (name, event_id) VALUES (?, ?)').run(
    name, parseInt(event_id, 10)
  );

  res.status(201).json({ id: result.lastInsertRowid, name, event_id: parseInt(event_id, 10) });
});

// GET /api/demo-pcs/:id/qr-payload
router.get('/:id/qr-payload', (req, res) => {
  const db = getDb();
  const pc = db.prepare('SELECT * FROM demo_pcs WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!pc) {
    return res.status(404).json({ error: 'Demo PC not found' });
  }

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(pc.event_id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // Get badge fields from profile
  let badgeFields = ['name', 'company', 'title'];
  if (event.badge_profile_id) {
    const profile = db.prepare('SELECT field_mappings FROM badge_profiles WHERE id = ?').get(event.badge_profile_id);
    if (profile) {
      const mappings = JSON.parse(profile.field_mappings);
      badgeFields = mappings.map(m => m.field_type);
    }
  }

  const managementUrl = process.env.MANAGEMENT_URL || `https://caseyapp.trendcyberrange.com`;

  const payload = {
    type: 'caseyapp-pair',
    v: 2,
    managementUrl,
    eventId: event.id,
    demoPcId: pc.name,
    badgeFields,
    eventName: event.name,
  };

  res.json({ payload });
});

// GET /api/demo-pcs/:id/qr-image - Generate QR code image
router.get('/:id/qr-image', async (req, res) => {
  const db = getDb();
  const pc = db.prepare('SELECT * FROM demo_pcs WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!pc) {
    return res.status(404).json({ error: 'Demo PC not found' });
  }

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(pc.event_id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  let badgeFields = ['name', 'company', 'title'];
  if (event.badge_profile_id) {
    const profile = db.prepare('SELECT field_mappings FROM badge_profiles WHERE id = ?').get(event.badge_profile_id);
    if (profile) {
      const mappings = JSON.parse(profile.field_mappings);
      badgeFields = mappings.map(m => m.field_type);
    }
  }

  const managementUrl = process.env.MANAGEMENT_URL || 'https://caseyapp.trendcyberrange.com';

  const payload = JSON.stringify({
    type: 'caseyapp-pair',
    v: 2,
    managementUrl,
    eventId: event.id,
    demoPcId: pc.name,
    badgeFields,
    eventName: event.name,
  });

  try {
    const QRCode = require('qrcode');
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      color: { dark: '#d71920', light: '#000000' },
      errorCorrectionLevel: 'H',
      margin: 2,
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code', detail: err.message });
  }
});

// DELETE /api/demo-pcs/:id (cascade pairings and nullify session references)
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const pcId = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM pairings WHERE demo_pc_id = ?').run(pcId);
  db.prepare('UPDATE sessions SET demo_pc_id = NULL WHERE demo_pc_id = ?').run(pcId);
  db.prepare('DELETE FROM demo_pcs WHERE id = ?').run(pcId);
  res.json({ ok: true });
});

module.exports = router;
