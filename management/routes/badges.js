'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

// POST /api/badges/profiles
router.post('/profiles', requireAuth, (req, res) => {
  const { name, event_id, field_mappings, extraction_prompt } = req.body;
  if (!name || !event_id) {
    return res.status(400).json({ error: 'Name and event_id required' });
  }

  const db = getDb();
  const result = db.prepare(
    'INSERT INTO badge_profiles (name, event_id, field_mappings, extraction_prompt) VALUES (?, ?, ?, ?)'
  ).run(
    name,
    parseInt(event_id, 10),
    JSON.stringify(field_mappings || []),
    extraction_prompt || ''
  );

  // Link profile to event
  db.prepare('UPDATE events SET badge_profile_id = ? WHERE id = ?').run(
    result.lastInsertRowid, parseInt(event_id, 10)
  );

  res.status(201).json({
    id: result.lastInsertRowid,
    name,
    event_id: parseInt(event_id, 10),
    field_mappings: field_mappings || [],
  });
});

// GET /api/badges/profiles/:id
router.get('/profiles/:id', requireAuth, (req, res) => {
  const db = getDb();
  const profile = db.prepare('SELECT * FROM badge_profiles WHERE id = ?').get(
    parseInt(req.params.id, 10)
  );
  if (!profile) {
    return res.status(404).json({ error: 'Badge profile not found' });
  }

  profile.field_mappings = JSON.parse(profile.field_mappings);
  profile.sample_corrections = JSON.parse(profile.sample_corrections);
  res.json({ profile });
});

// PUT /api/badges/profiles/:id
router.put('/profiles/:id', requireAuth, (req, res) => {
  const { field_mappings, extraction_prompt, sample_corrections } = req.body;
  const db = getDb();

  db.prepare(
    'UPDATE badge_profiles SET field_mappings = ?, extraction_prompt = ?, sample_corrections = ? WHERE id = ?'
  ).run(
    JSON.stringify(field_mappings || []),
    extraction_prompt || '',
    JSON.stringify(sample_corrections || []),
    parseInt(req.params.id, 10)
  );

  res.json({ ok: true });
});

// POST /api/badges/scan - AI badge extraction
router.post('/scan', requireAuth, upload.single('badge_image'), async (req, res) => {
  const { event_id } = req.body;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id required' });
  }

  const db = getDb();
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(parseInt(event_id, 10));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // Get badge profile for extraction rules
  let profile = null;
  if (event.badge_profile_id) {
    profile = db.prepare('SELECT * FROM badge_profiles WHERE id = ?').get(event.badge_profile_id);
    if (profile) {
      profile.field_mappings = JSON.parse(profile.field_mappings);
    }
  }

  // In production, this would call Claude Vision API with the badge image
  // For now, return a placeholder response indicating AI extraction is configured
  const fields = {};
  if (profile && profile.field_mappings) {
    for (const mapping of profile.field_mappings) {
      fields[mapping.field_type] = '';
    }
  } else {
    // Default fields if no profile
    fields.name = '';
    fields.company = '';
    fields.title = '';
  }

  res.json({
    extracted_fields: fields,
    profile_used: profile ? profile.name : 'default',
    needs_ai_key: !process.env.ANTHROPIC_API_KEY && !process.env.RONE_AI_API_KEY,
  });
});

// POST /api/badges/profiles/:id/train - Upload sample and train
router.post('/profiles/:id/train', requireAuth, upload.single('sample_image'), async (req, res) => {
  const profileId = parseInt(req.params.id, 10);
  const db = getDb();
  const profile = db.prepare('SELECT * FROM badge_profiles WHERE id = ?').get(profileId);

  if (!profile) {
    return res.status(404).json({ error: 'Badge profile not found' });
  }

  // In production, this would call Claude Vision to analyze the sample
  // and return field guesses for admin to correct
  res.json({
    profile_id: profileId,
    message: 'Sample uploaded. AI analysis requires ANTHROPIC_API_KEY or RONE_AI_API_KEY.',
    suggested_fields: [
      { field_type: 'name', label: 'Name', confidence: 0.9 },
      { field_type: 'company', label: 'Company', confidence: 0.85 },
      { field_type: 'title', label: 'Title', confidence: 0.7 },
    ],
  });
});

module.exports = router;
