'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

/**
 * Parse CSV text into array of objects.
 * Handles quoted fields and common delimiters.
 */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  const headers = parseCsvLine(firstLine, delimiter).map(h => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || '').trim();
    });
    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Auto-detect column mapping from CSV headers.
 */
function detectColumnMapping(headers) {
  const mapping = {};
  const patterns = {
    name: /^(full.?name|name|attendee.?name|first.?name)$/i,
    email: /^(email|e.?mail|email.?address)$/i,
    company: /^(company|organization|org|employer)$/i,
    title: /^(title|job.?title|position|role)$/i,
    phone: /^(phone|telephone|mobile|cell)$/i,
    address: /^(address|location|city|state)$/i,
    lead_score: /^(lead.?score|score|rating|priority)$/i,
  };

  for (const header of headers) {
    for (const [field, pattern] of Object.entries(patterns)) {
      if (pattern.test(header) && !mapping[field]) {
        mapping[field] = header;
      }
    }
  }

  return mapping;
}

// GET /api/contacts
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { event_id } = req.query;
  let contacts;
  if (event_id) {
    contacts = db.prepare('SELECT * FROM contacts WHERE event_id = ? ORDER BY name').all(parseInt(event_id, 10));
  } else {
    contacts = db.prepare('SELECT * FROM contacts ORDER BY name').all();
  }
  res.json({ contacts });
});

// POST /api/contacts/import - CSV import
router.post('/import', requireAuth, upload.single('csv_file'), (req, res) => {
  const { event_id } = req.body;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id required' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'CSV file required' });
  }

  const csvText = fs.readFileSync(req.file.path, 'utf-8');
  fs.unlinkSync(req.file.path); // Clean up temp file

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return res.status(400).json({ error: 'CSV file is empty or has no data rows' });
  }

  const headers = Object.keys(rows[0]);
  const mapping = detectColumnMapping(headers);

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO contacts (event_id, name, email, company, title, phone, address, lead_score, extra_fields)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((contacts) => {
    for (const row of contacts) {
      const extra = {};
      for (const [key, value] of Object.entries(row)) {
        if (!Object.values(mapping).includes(key) && value) {
          extra[key] = value;
        }
      }

      insert.run(
        parseInt(event_id, 10),
        row[mapping.name] || null,
        row[mapping.email] || null,
        row[mapping.company] || null,
        row[mapping.title] || null,
        row[mapping.phone] || null,
        row[mapping.address] || null,
        row[mapping.lead_score] || null,
        JSON.stringify(extra)
      );
    }
  });

  insertMany(rows);

  res.json({
    imported: rows.length,
    column_mapping: mapping,
    event_id: parseInt(event_id, 10),
  });
});

// POST /api/contacts/match - AI matching
router.post('/match', requireAuth, async (req, res) => {
  const { event_id } = req.body;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id required' });
  }

  const db = getDb();
  const eid = parseInt(event_id, 10);

  // Get unmatched sessions
  const sessions = db.prepare(`
    SELECT s.* FROM sessions s
    LEFT JOIN contact_matches cm ON s.id = cm.session_id
    WHERE s.event_id = ? AND cm.id IS NULL AND s.visitor_name IS NOT NULL
  `).all(eid);

  // Get all contacts for the event
  const contacts = db.prepare('SELECT * FROM contacts WHERE event_id = ?').all(eid);

  if (contacts.length === 0) {
    return res.json({ matches: [], message: 'No contacts imported yet' });
  }

  // Simple fuzzy matching (in production, this would use Claude AI)
  const matches = [];
  for (const session of sessions) {
    let bestMatch = null;
    let bestScore = 0;

    for (const contact of contacts) {
      let score = 0;

      // Name similarity
      if (session.visitor_name && contact.name) {
        const sName = session.visitor_name.toLowerCase();
        const cName = contact.name.toLowerCase();
        if (sName === cName) score += 60;
        else if (sName.includes(cName) || cName.includes(sName)) score += 40;
        else {
          // Check individual words
          const sWords = sName.split(/\s+/);
          const cWords = cName.split(/\s+/);
          const commonWords = sWords.filter(w => cWords.includes(w));
          score += commonWords.length * 20;
        }
      }

      // Company similarity
      if (session.visitor_company && contact.company) {
        const sComp = session.visitor_company.toLowerCase();
        const cComp = contact.company.toLowerCase();
        if (sComp === cComp) score += 30;
        else if (sComp.includes(cComp) || cComp.includes(sComp)) score += 15;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = contact;
      }
    }

    if (bestMatch && bestScore >= 40) {
      const confidence = Math.min(bestScore, 100);
      db.prepare(
        'INSERT INTO contact_matches (session_id, contact_id, confidence, reasoning) VALUES (?, ?, ?, ?)'
      ).run(session.id, bestMatch.id, confidence, `Name/company match (score: ${bestScore})`);

      matches.push({
        session_id: session.id,
        visitor_name: session.visitor_name,
        matched_contact: bestMatch.name,
        matched_email: bestMatch.email,
        confidence,
        reasoning: `Name/company match (score: ${bestScore})`,
      });
    }
  }

  res.json({
    matches,
    unmatched: sessions.length - matches.length,
    total_sessions: sessions.length,
    ai_available: !!(process.env.ANTHROPIC_API_KEY || process.env.RONE_AI_API_KEY),
  });
});

// GET /api/contacts/matches
router.get('/matches', requireAuth, (req, res) => {
  const { event_id } = req.query;
  const db = getDb();
  let matches;
  if (event_id) {
    matches = db.prepare(`
      SELECT cm.*, s.visitor_name, s.visitor_company, c.name as contact_name, c.email as contact_email
      FROM contact_matches cm
      JOIN sessions s ON cm.session_id = s.id
      JOIN contacts c ON cm.contact_id = c.id
      WHERE s.event_id = ?
      ORDER BY cm.confidence DESC
    `).all(parseInt(event_id, 10));
  } else {
    matches = db.prepare(`
      SELECT cm.*, s.visitor_name, s.visitor_company, c.name as contact_name, c.email as contact_email
      FROM contact_matches cm
      JOIN sessions s ON cm.session_id = s.id
      JOIN contacts c ON cm.contact_id = c.id
      ORDER BY cm.confidence DESC
    `).all();
  }
  res.json({ matches });
});

// PUT /api/contacts/matches/:id - Manual override
router.put('/matches/:id', requireAuth, (req, res) => {
  const { contact_id } = req.body;
  const db = getDb();
  db.prepare('UPDATE contact_matches SET contact_id = ?, manual_override = 1 WHERE id = ?').run(
    parseInt(contact_id, 10), parseInt(req.params.id, 10)
  );
  res.json({ ok: true });
});

module.exports = router;
