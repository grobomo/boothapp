const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { getDb } = require('./db');
const { matchContact } = require('./ai');

const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /\.csv$/i.test(path.extname(file.originalname)));
  }
});

// Auto-detect CSV column mapping from header names
function detectColumns(headers) {
  const mapping = {};
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  const patterns = {
    name: /^(name|full.?name|contact.?name|first.?name)$/,
    email: /^(email|e.?mail|email.?address)$/,
    company: /^(company|organization|org|employer)$/,
    title: /^(title|job.?title|position|role)$/,
    phone: /^(phone|telephone|mobile|cell)$/,
    address: /^(address|location|city|state)$/,
    lead_score: /^(lead.?score|score|priority|rating)$/
  };

  for (const [field, pattern] of Object.entries(patterns)) {
    const idx = lowerHeaders.findIndex(h => pattern.test(h));
    if (idx >= 0) mapping[field] = headers[idx];
  }

  return mapping;
}

function createRouter() {
  const router = express.Router();

  // Upload CSV contacts for an event
  router.post('/api/events/:eventId/contacts/import', upload.single('csv'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'CSV file required' });

      const db = getDb();
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.eventId);
      if (!event) return res.status(404).json({ error: 'Event not found' });

      const csvText = fs.readFileSync(req.file.path, 'utf-8');
      const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });

      if (records.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'CSV is empty' });
      }

      const headers = Object.keys(records[0]);
      const mapping = detectColumns(headers);

      const insert = db.prepare(`INSERT INTO contacts (event_id, name, email, company, title, phone, address, lead_score, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      let imported = 0;
      const insertMany = db.transaction(() => {
        for (const row of records) {
          const extra = {};
          for (const h of headers) {
            if (!Object.values(mapping).includes(h)) extra[h] = row[h];
          }
          insert.run(
            req.params.eventId,
            mapping.name ? row[mapping.name] : null,
            mapping.email ? row[mapping.email] : null,
            mapping.company ? row[mapping.company] : null,
            mapping.title ? row[mapping.title] : null,
            mapping.phone ? row[mapping.phone] : null,
            mapping.address ? row[mapping.address] : null,
            mapping.lead_score ? row[mapping.lead_score] : null,
            Object.keys(extra).length ? JSON.stringify(extra) : null
          );
          imported++;
        }
      });

      insertMany();
      fs.unlinkSync(req.file.path);

      res.json({ imported, column_mapping: mapping, total_columns: headers.length });
    } catch (err) {
      if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      res.status(500).json({ error: err.message });
    }
  });

  // List contacts for an event
  router.get('/api/events/:eventId/contacts', (req, res) => {
    const db = getDb();
    const contacts = db.prepare('SELECT * FROM contacts WHERE event_id = ? ORDER BY name').all(req.params.eventId);
    res.json({ contacts, count: contacts.length });
  });

  // Run AI matching for an event
  router.post('/api/events/:eventId/match', async (req, res) => {
    try {
      const db = getDb();
      const contacts = db.prepare('SELECT * FROM contacts WHERE event_id = ?').all(req.params.eventId);
      if (contacts.length === 0) return res.status(400).json({ error: 'No contacts imported for this event' });

      const sessions = db.prepare('SELECT * FROM sessions WHERE event_id = ? AND contact_id IS NULL').all(req.params.eventId);
      if (sessions.length === 0) return res.json({ matched: 0, message: 'No unmatched sessions' });

      const results = [];
      // Process in batches of 50 contacts
      for (const session of sessions) {
        const batchSize = 50;
        let bestMatch = { match_index: 0, confidence: 0, reasoning: '' };

        for (let i = 0; i < contacts.length; i += batchSize) {
          const batch = contacts.slice(i, i + batchSize);
          const result = await matchContact(session.visitor_name, session.visitor_company, batch);

          if (result.confidence > bestMatch.confidence) {
            bestMatch = {
              match_index: result.match_index > 0 ? i + result.match_index : 0,
              confidence: result.confidence,
              reasoning: result.reasoning
            };
          }
        }

        if (bestMatch.match_index > 0 && bestMatch.confidence > 0) {
          const contact = contacts[bestMatch.match_index - 1];
          db.prepare('INSERT INTO contact_matches (session_id, contact_id, confidence, reasoning) VALUES (?, ?, ?, ?)')
            .run(session.id, contact.id, bestMatch.confidence, bestMatch.reasoning);
          db.prepare('UPDATE sessions SET contact_id = ? WHERE id = ?').run(contact.id, session.id);

          results.push({
            session_id: session.id,
            visitor_name: session.visitor_name,
            matched_contact: contact.name,
            confidence: bestMatch.confidence,
            reasoning: bestMatch.reasoning
          });
        }
      }

      res.json({ matched: results.length, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get match results for an event
  router.get('/api/events/:eventId/matches', (req, res) => {
    const db = getDb();
    const matches = db.prepare(`
      SELECT cm.*, s.visitor_name, s.visitor_company, c.name as contact_name, c.email as contact_email, c.company as contact_company
      FROM contact_matches cm
      JOIN sessions s ON cm.session_id = s.id
      JOIN contacts c ON cm.contact_id = c.id
      WHERE s.event_id = ?
      ORDER BY cm.confidence DESC
    `).all(req.params.eventId);
    res.json({ matches });
  });

  // Manual override match
  router.put('/api/sessions/:sessionId/match', (req, res) => {
    const db = getDb();
    const { contact_id } = req.body;
    if (!contact_id) return res.status(400).json({ error: 'contact_id required' });

    db.prepare('UPDATE sessions SET contact_id = ? WHERE id = ?').run(contact_id, req.params.sessionId);

    // Update or create match record
    const existing = db.prepare('SELECT * FROM contact_matches WHERE session_id = ?').get(req.params.sessionId);
    if (existing) {
      db.prepare('UPDATE contact_matches SET contact_id = ?, confidence = 100, manual_override = 1 WHERE session_id = ?')
        .run(contact_id, req.params.sessionId);
    } else {
      db.prepare('INSERT INTO contact_matches (session_id, contact_id, confidence, reasoning, manual_override) VALUES (?, ?, 100, ?, 1)')
        .run(req.params.sessionId, contact_id, 'Manual override');
    }

    res.json({ updated: true });
  });

  return router;
}

module.exports = { createRouter };
