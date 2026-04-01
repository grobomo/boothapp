'use strict';

const express = require('express');
const { getDb, hashPassword, verifyPassword, generateToken } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token, user.id, expiresAt
  );

  res.cookie('session_token', token, {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      force_password_change: !!user.force_password_change,
    },
  });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  const token = req.cookies?.session_token || req.headers.authorization?.replace('Bearer ', '');
  const db = getDb();
  db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  res.clearCookie('session_token');
  res.json({ ok: true });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  // If force_password_change, don't require current password
  if (!user.force_password_change) {
    if (!current_password || !verifyPassword(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }

  const hash = hashPassword(new_password);
  db.prepare('UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?').run(hash, user.id);

  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// --- User Management (admin only) ---

// GET /api/users
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, username, role, force_password_change, created_at FROM users').all();
  res.json({ users });
});

// POST /api/users
router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const hash = hashPassword(password);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, role, force_password_change) VALUES (?, ?, ?, 1)'
  ).run(username, hash, role || 'user');

  res.status(201).json({ id: result.lastInsertRowid, username, role: role || 'user' });
});

// DELETE /api/users/:id
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const userId = parseInt(req.params.id, 10);

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ ok: true });
});

// POST /api/users/:id/reset-password
router.post('/users/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const { new_password } = req.body;
  if (!new_password) {
    return res.status(400).json({ error: 'New password required' });
  }

  const db = getDb();
  const hash = hashPassword(new_password);
  db.prepare('UPDATE users SET password_hash = ?, force_password_change = 1 WHERE id = ?').run(
    hash, parseInt(req.params.id, 10)
  );

  res.json({ ok: true });
});

module.exports = router;
