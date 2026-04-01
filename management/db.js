'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.MANAGEMENT_DB || path.join(__dirname, 'data', 'caseyapp.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      force_password_change INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT,
      location TEXT,
      active INTEGER NOT NULL DEFAULT 0,
      badge_profile_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (badge_profile_id) REFERENCES badge_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS badge_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      event_id INTEGER,
      field_mappings TEXT NOT NULL DEFAULT '[]',
      extraction_prompt TEXT DEFAULT '',
      sample_corrections TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events(id)
    );

    CREATE TABLE IF NOT EXISTS demo_pcs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      event_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      event_id INTEGER NOT NULL,
      demo_pc_id INTEGER,
      visitor_name TEXT,
      visitor_company TEXT,
      visitor_title TEXT,
      visitor_fields TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      audio_opted_out INTEGER NOT NULL DEFAULT 0,
      s3_prefix TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (demo_pc_id) REFERENCES demo_pcs(id)
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      name TEXT,
      email TEXT,
      company TEXT,
      title TEXT,
      phone TEXT,
      address TEXT,
      lead_score TEXT,
      extra_fields TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events(id)
    );

    CREATE TABLE IF NOT EXISTS contact_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      contact_id INTEGER NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 0,
      reasoning TEXT,
      manual_override INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pairings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      demo_pc_id INTEGER NOT NULL UNIQUE,
      device_id TEXT NOT NULL,
      device_name TEXT DEFAULT 'Unknown',
      paired_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (demo_pc_id) REFERENCES demo_pcs(id)
    );
  `);

  // Seed default admin if no users exist
  const count = d.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (count.cnt === 0) {
    const bcrypt = require('bcrypt');
    const hash = bcrypt.hashSync('admin', 10);
    d.prepare(
      'INSERT INTO users (username, password_hash, role, force_password_change) VALUES (?, ?, ?, ?)'
    ).run('admin', hash, 'admin', 1);
  }
}

function hashPassword(password) {
  const bcrypt = require('bcrypt');
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  const bcrypt = require('bcrypt');
  return bcrypt.compareSync(password, hash);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { getDb, hashPassword, verifyPassword, generateToken };
