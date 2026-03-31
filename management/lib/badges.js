const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');
const { extractBadgeFields } = require('./ai');

const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  }
});

function createRouter() {
  const router = express.Router();

  // Scan a badge photo — returns extracted fields
  router.post('/api/badges/scan', upload.single('photo'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Photo required' });

      const eventId = req.body.event_id;
      const db = getDb();

      // Get badge profile for the event
      let badgeProfile = null;
      if (eventId) {
        const event = db.prepare('SELECT badge_profile FROM events WHERE id = ?').get(eventId);
        if (event?.badge_profile) {
          try { badgeProfile = JSON.parse(event.badge_profile); } catch { /* use default */ }
        }
      }

      // Read image and convert to base64
      const imageBuffer = fs.readFileSync(req.file.path);
      const imageBase64 = imageBuffer.toString('base64');
      const mediaType = req.file.mimetype || 'image/jpeg';

      const fields = await extractBadgeFields(imageBase64, mediaType, badgeProfile);

      // Clean up temp file
      fs.unlinkSync(req.file.path);

      res.json({ fields });
    } catch (err) {
      if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      res.status(500).json({ error: err.message });
    }
  });

  // Upload badge training sample
  router.post('/api/events/:eventId/badge-samples', upload.single('sample'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Sample image required' });

      const db = getDb();
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.eventId);
      if (!event) return res.status(404).json({ error: 'Event not found' });

      // Extract fields from sample using Claude Vision
      const imageBuffer = fs.readFileSync(req.file.path);
      const imageBase64 = imageBuffer.toString('base64');
      const mediaType = req.file.mimetype || 'image/jpeg';

      let extraction = null;
      try {
        extraction = await extractBadgeFields(imageBase64, mediaType, null);
      } catch { /* AI extraction optional during training */ }

      const result = db.prepare('INSERT INTO badge_samples (event_id, filename, extraction) VALUES (?, ?, ?)')
        .run(req.params.eventId, req.file.originalname, extraction ? JSON.stringify(extraction) : null);

      // Move file to persistent uploads dir
      const dest = path.join(__dirname, '..', 'uploads', `badge-sample-${result.lastInsertRowid}${path.extname(req.file.originalname)}`);
      fs.renameSync(req.file.path, dest);

      res.status(201).json({
        id: result.lastInsertRowid,
        filename: req.file.originalname,
        extraction
      });
    } catch (err) {
      if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      res.status(500).json({ error: err.message });
    }
  });

  // List badge samples for an event
  router.get('/api/events/:eventId/badge-samples', (req, res) => {
    const db = getDb();
    const samples = db.prepare('SELECT * FROM badge_samples WHERE event_id = ?').all(req.params.eventId);
    res.json({ samples });
  });

  // Save badge profile corrections for an event
  router.put('/api/events/:eventId/badge-profile', (req, res) => {
    const db = getDb();
    const { field_mappings, extraction_prompt, sample_corrections } = req.body;

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const profile = {
      name: event.name,
      field_mappings: field_mappings || [
        { field_type: 'name', label: 'Name', required: true },
        { field_type: 'company', label: 'Company', required: true },
        { field_type: 'title', label: 'Title', required: false }
      ],
      extraction_prompt: extraction_prompt || '',
      sample_corrections: sample_corrections || []
    };

    db.prepare('UPDATE events SET badge_profile = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(JSON.stringify(profile), req.params.eventId);

    res.json(profile);
  });

  // Get badge profile for an event
  router.get('/api/events/:eventId/badge-profile', (req, res) => {
    const db = getDb();
    const event = db.prepare('SELECT badge_profile FROM events WHERE id = ?').get(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!event.badge_profile) return res.json(null);
    res.json(JSON.parse(event.badge_profile));
  });

  return router;
}

module.exports = { createRouter };
