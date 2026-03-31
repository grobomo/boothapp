'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'contacts.db');

let _db = null;

function getDb() {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      company TEXT,
      title TEXT,
      phone TEXT,
      address TEXT,
      lead_score TEXT,
      notes TEXT,
      raw_row TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, email)
    );

    CREATE TABLE IF NOT EXISTS contact_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      contact_id INTEGER REFERENCES contacts(id),
      confidence INTEGER DEFAULT 0,
      reasoning TEXT,
      matched_by TEXT DEFAULT 'ai',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(session_id)
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_event ON contacts(event_id);
    CREATE INDEX IF NOT EXISTS idx_matches_session ON contact_matches(session_id);
    CREATE INDEX IF NOT EXISTS idx_matches_event ON contact_matches(event_id);
  `);
}

// --- Contact CRUD ---

function insertContacts(eventId, contacts) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO contacts (event_id, name, email, company, title, phone, address, lead_score, notes, raw_row)
    VALUES (@event_id, @name, @email, @company, @title, @phone, @address, @lead_score, @notes, @raw_row)
  `);
  const tx = db.transaction((rows) => {
    let inserted = 0;
    for (const row of rows) {
      const info = stmt.run({
        event_id: eventId,
        name: row.name || null,
        email: row.email || null,
        company: row.company || null,
        title: row.title || null,
        phone: row.phone || null,
        address: row.address || null,
        lead_score: row.lead_score || null,
        notes: row.notes || null,
        raw_row: JSON.stringify(row),
      });
      if (info.changes > 0) inserted++;
    }
    return inserted;
  });
  return tx(contacts);
}

function getContacts(eventId) {
  const db = getDb();
  return db.prepare('SELECT * FROM contacts WHERE event_id = ? ORDER BY name').all(eventId);
}

function deleteContacts(eventId) {
  const db = getDb();
  db.prepare('DELETE FROM contact_matches WHERE event_id = ?').run(eventId);
  const info = db.prepare('DELETE FROM contacts WHERE event_id = ?').run(eventId);
  return info.changes;
}

function getContactCount(eventId) {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as count FROM contacts WHERE event_id = ?').get(eventId).count;
}

// --- Match CRUD ---

function upsertMatch(sessionId, eventId, contactId, confidence, reasoning, matchedBy) {
  const db = getDb();
  db.prepare(`
    INSERT INTO contact_matches (session_id, event_id, contact_id, confidence, reasoning, matched_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      contact_id = excluded.contact_id,
      confidence = excluded.confidence,
      reasoning = excluded.reasoning,
      matched_by = excluded.matched_by,
      created_at = datetime('now')
  `).run(sessionId, eventId, contactId, confidence, reasoning, matchedBy || 'ai');
}

function getMatches(eventId) {
  const db = getDb();
  return db.prepare(`
    SELECT m.*, c.name as contact_name, c.email as contact_email, c.company as contact_company, c.title as contact_title
    FROM contact_matches m
    LEFT JOIN contacts c ON m.contact_id = c.id
    WHERE m.event_id = ?
    ORDER BY m.confidence DESC
  `).all(eventId);
}

function getMatchForSession(sessionId) {
  const db = getDb();
  return db.prepare(`
    SELECT m.*, c.name as contact_name, c.email as contact_email, c.company as contact_company, c.title as contact_title
    FROM contact_matches m
    LEFT JOIN contacts c ON m.contact_id = c.id
    WHERE m.session_id = ?
  `).get(sessionId);
}

function deleteMatch(sessionId) {
  const db = getDb();
  db.prepare('DELETE FROM contact_matches WHERE session_id = ?').run(sessionId);
}

module.exports = {
  getDb,
  insertContacts,
  getContacts,
  deleteContacts,
  getContactCount,
  upsertMatch,
  getMatches,
  getMatchForSession,
  deleteMatch,
};
