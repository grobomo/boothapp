const express = require('express');
const { getDb, hashPassword } = require('./db');
const { requireAdmin } = require('./auth');

function createRouter() {
  const router = express.Router();

  // List users (admin only)
  router.get('/api/users', requireAdmin, (req, res) => {
    const db = getDb();
    const users = db.prepare('SELECT id, username, role, force_password_change, created_at, updated_at FROM users ORDER BY created_at').all();
    res.json({ users });
  });

  // Create user (admin only)
  router.post('/api/users', requireAdmin, (req, res) => {
    const db = getDb();
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'Username already exists' });

    const { hash, salt } = hashPassword(password);
    const result = db.prepare('INSERT INTO users (username, password_hash, salt, role, force_password_change) VALUES (?, ?, ?, ?, 1)')
      .run(username, hash, salt, role || 'user');

    res.status(201).json({
      id: result.lastInsertRowid,
      username,
      role: role || 'user',
      force_password_change: true
    });
  });

  // Reset password (admin only)
  router.post('/api/users/:id/reset-password', requireAdmin, (req, res) => {
    const db = getDb();
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'password required' });

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { hash, salt } = hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ?, salt = ?, force_password_change = 1, updated_at = datetime(\'now\') WHERE id = ?')
      .run(hash, salt, req.params.id);

    res.json({ reset: true });
  });

  // Delete user (admin only)
  router.delete('/api/users/:id', requireAdmin, (req, res) => {
    const db = getDb();
    // Prevent deleting yourself
    if (parseInt(req.params.id) === req.user.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ deleted: true });
  });

  return router;
}

module.exports = { createRouter };
