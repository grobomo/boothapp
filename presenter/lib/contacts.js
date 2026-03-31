'use strict';

const express = require('express');
const { Router } = express;
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { S3Cache } = require('../../infra/s3-cache');
const db = require('./contacts-db');

const upload = multer({ dest: path.join(__dirname, '..', 'data', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 } });

// --- CSV Parsing ---

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && !values[0])) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

// --- Auto-detect column mapping ---

const FIELD_PATTERNS = {
  name:       /^(full[\s_-]?name|name|contact[\s_-]?name|attendee[\s_-]?name|first[\s_-]?name[\s_-]?last[\s_-]?name)$/i,
  first_name: /^(first[\s_-]?name|fname|given[\s_-]?name)$/i,
  last_name:  /^(last[\s_-]?name|lname|surname|family[\s_-]?name)$/i,
  email:      /^(email|e[\s_-]?mail|email[\s_-]?address)$/i,
  company:    /^(company|organization|org|employer|company[\s_-]?name)$/i,
  title:      /^(title|job[\s_-]?title|position|role)$/i,
  phone:      /^(phone|telephone|mobile|cell|phone[\s_-]?number)$/i,
  address:    /^(address|location|city|state|country)$/i,
  lead_score: /^(lead[\s_-]?score|score|priority|rating)$/i,
  notes:      /^(notes|comments|remarks)$/i,
};

function autoDetectMapping(headers) {
  const mapping = {};
  const unmapped = [];

  for (const header of headers) {
    let matched = false;
    for (const [field, pattern] of Object.entries(FIELD_PATTERNS)) {
      if (pattern.test(header)) {
        if (!mapping[field]) {
          mapping[field] = header;
          matched = true;
          break;
        }
      }
    }
    if (!matched) unmapped.push(header);
  }

  return { mapping, unmapped };
}

function applyMapping(rows, mapping) {
  return rows.map(row => {
    const contact = {};
    // Handle first_name + last_name -> name
    if (mapping.first_name && mapping.last_name) {
      const fn = row[mapping.first_name] || '';
      const ln = row[mapping.last_name] || '';
      contact.name = `${fn} ${ln}`.trim();
    } else if (mapping.name) {
      contact.name = row[mapping.name] || '';
    }

    for (const field of ['email', 'company', 'title', 'phone', 'address', 'lead_score', 'notes']) {
      if (mapping[field]) {
        contact[field] = row[mapping[field]] || '';
      }
    }
    return contact;
  });
}

// --- AI Matching with Claude ---

async function matchSessionsWithAI(eventId, sessions, opts) {
  const contacts = db.getContacts(eventId);
  if (!contacts.length) return { error: 'No contacts imported for this event' };

  const existingMatches = db.getMatches(eventId);
  const matchedSessionIds = new Set(existingMatches.map(m => m.session_id));

  // Filter to unmatched sessions only (unless force rematch)
  const unmatchedSessions = opts.force
    ? sessions
    : sessions.filter(s => !matchedSessionIds.has(s.session_id));

  if (!unmatchedSessions.length) return { matched: 0, message: 'All sessions already matched' };

  const results = [];
  const BATCH_SIZE = 50;

  for (const session of unmatchedSessions) {
    const visitorName = session.visitor_name || session.name || 'Unknown';
    const visitorCompany = session.company || '';

    let bestMatch = null;

    // Process contacts in batches of 50
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      const batchResult = await callClaudeForMatch(visitorName, visitorCompany, batch, i / BATCH_SIZE + 1);

      if (batchResult && (!bestMatch || batchResult.confidence > bestMatch.confidence)) {
        bestMatch = batchResult;
      }
    }

    if (bestMatch && bestMatch.contact_id) {
      db.upsertMatch(session.session_id, eventId, bestMatch.contact_id, bestMatch.confidence, bestMatch.reasoning, 'ai');
      results.push({
        session_id: session.session_id,
        visitor_name: visitorName,
        contact_id: bestMatch.contact_id,
        contact_name: bestMatch.contact_name,
        confidence: bestMatch.confidence,
        reasoning: bestMatch.reasoning,
      });
    } else {
      // No match found — store with confidence 0
      db.upsertMatch(session.session_id, eventId, null, 0, 'No matching contact found', 'ai');
      results.push({
        session_id: session.session_id,
        visitor_name: visitorName,
        contact_id: null,
        contact_name: null,
        confidence: 0,
        reasoning: 'No matching contact found',
      });
    }
  }

  return { matched: results.filter(r => r.contact_id).length, total: results.length, results };
}

async function callClaudeForMatch(visitorName, visitorCompany, contactBatch, batchNum) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const contactList = contactBatch.map(c =>
    `[ID:${c.id}] ${c.name || 'N/A'} | ${c.company || 'N/A'} | ${c.email || 'N/A'} | ${c.title || 'N/A'}`
  ).join('\n');

  const prompt = `You are matching a trade show visitor to their contact record from an attendee list.

VISITOR (from badge OCR scan):
- Name: ${visitorName}
- Company: ${visitorCompany || 'Unknown'}

CONTACT LIST (batch ${batchNum}):
${contactList}

INSTRUCTIONS:
- Find the best matching contact considering: name variations, nicknames, company abbreviations, OCR typos
- Names may have OCR errors (e.g., "Sarrah" = "Sarah", "Jhn" = "John")
- Companies may be abbreviated (e.g., "MS" = "Microsoft", "AWS" = "Amazon Web Services")
- Return ONLY valid JSON, no other text

Return JSON:
{
  "contact_id": <id number or null if no match>,
  "confidence": <0-100>,
  "reasoning": "<brief explanation>"
}

If no contact is a reasonable match, return {"contact_id": null, "confidence": 0, "reasoning": "No match found in this batch"}.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[contacts] Claude API error: ${resp.status} ${errText}`);
    return null;
  }

  const data = await resp.json();
  const text = (data.content && data.content[0] && data.content[0].text) || '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    // Find the contact name for the matched ID
    const matchedContact = contactBatch.find(c => c.id === parsed.contact_id);
    return {
      contact_id: parsed.contact_id,
      contact_name: matchedContact ? matchedContact.name : null,
      confidence: Math.max(0, Math.min(100, parseInt(parsed.confidence, 10) || 0)),
      reasoning: String(parsed.reasoning || '').slice(0, 500),
    };
  } catch (e) {
    console.error(`[contacts] Failed to parse Claude response: ${e.message}`);
    return null;
  }
}

// --- Router ---

function createRouter(opts) {
  const router = Router();
  const bucket = (opts && opts.bucket) || process.env.S3_BUCKET || 'boothapp-sessions-752266476357';
  const s3cache = new S3Cache({ bucket });

  // GET /api/contacts?event_id=xxx
  router.get('/api/contacts', (req, res) => {
    const eventId = req.query.event_id || 'default';
    const contacts = db.getContacts(eventId);
    const count = contacts.length;
    res.json({ event_id: eventId, count, contacts });
  });

  // POST /api/contacts/upload — CSV file upload
  router.post('/api/contacts/upload', upload.single('csv'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

      const eventId = req.body.event_id || 'default';
      const text = fs.readFileSync(req.file.path, 'utf-8');

      // Clean up uploaded file
      fs.unlinkSync(req.file.path);

      const { headers, rows } = parseCSV(text);
      if (!headers.length) return res.status(400).json({ error: 'CSV has no headers' });
      if (!rows.length) return res.status(400).json({ error: 'CSV has no data rows' });

      const { mapping, unmapped } = autoDetectMapping(headers);
      const contacts = applyMapping(rows, mapping);
      const inserted = db.insertContacts(eventId, contacts);

      res.json({
        event_id: eventId,
        headers_detected: headers,
        column_mapping: mapping,
        unmapped_columns: unmapped,
        total_rows: rows.length,
        inserted,
        duplicates_skipped: rows.length - inserted,
      });
    } catch (err) {
      console.error('[contacts] Upload error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/contacts/preview — Preview CSV mapping without importing
  router.post('/api/contacts/preview', upload.single('csv'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

      const text = fs.readFileSync(req.file.path, 'utf-8');
      fs.unlinkSync(req.file.path);

      const { headers, rows } = parseCSV(text);
      if (!headers.length) return res.status(400).json({ error: 'CSV has no headers' });

      const { mapping, unmapped } = autoDetectMapping(headers);
      const preview = applyMapping(rows.slice(0, 5), mapping);

      res.json({
        headers_detected: headers,
        column_mapping: mapping,
        unmapped_columns: unmapped,
        total_rows: rows.length,
        preview,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/contacts?event_id=xxx
  router.delete('/api/contacts', (req, res) => {
    const eventId = req.query.event_id || 'default';
    const deleted = db.deleteContacts(eventId);
    res.json({ event_id: eventId, deleted });
  });

  // POST /api/contacts/match — Run AI matching
  router.post('/api/contacts/match', express.json(), async (req, res) => {
    try {
      const eventId = req.body.event_id || 'default';
      const force = !!req.body.force;

      // Get sessions from S3
      const sessions = await s3cache.listSessions();
      if (!sessions.length) return res.status(400).json({ error: 'No sessions found' });

      const result = await matchSessionsWithAI(eventId, sessions, { force });
      res.json(result);
    } catch (err) {
      console.error('[contacts] Match error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/contacts/matches?event_id=xxx
  router.get('/api/contacts/matches', (req, res) => {
    const eventId = req.query.event_id || 'default';
    const matches = db.getMatches(eventId);
    res.json({ event_id: eventId, count: matches.length, matches });
  });

  // PUT /api/contacts/matches/:sessionId — Manual override
  router.put('/api/contacts/matches/:sessionId', express.json(), (req, res) => {
    const { sessionId } = req.params;
    const { contact_id, event_id } = req.body;
    const eventId = event_id || 'default';

    if (!contact_id) return res.status(400).json({ error: 'contact_id required' });

    const contacts = db.getContacts(eventId);
    const contact = contacts.find(c => c.id === parseInt(contact_id, 10));
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    db.upsertMatch(sessionId, eventId, contact.id, 100, 'Manually matched by admin', 'manual');
    res.json({
      session_id: sessionId,
      contact_id: contact.id,
      contact_name: contact.name,
      confidence: 100,
      matched_by: 'manual',
    });
  });

  // DELETE /api/contacts/matches/:sessionId — Remove match
  router.delete('/api/contacts/matches/:sessionId', (req, res) => {
    db.deleteMatch(req.params.sessionId);
    res.json({ deleted: true });
  });

  return router;
}

module.exports = { createRouter };
