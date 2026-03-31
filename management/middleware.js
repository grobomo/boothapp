'use strict';

const { getDb } = require('./db');

/**
 * Authentication middleware.
 * Checks for session cookie or Authorization header.
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.session_token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = getDb();
  const session = db.prepare(
    "SELECT s.*, u.username, u.role, u.force_password_change FROM auth_sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime('now')"
  ).get(token);

  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  req.user = {
    id: session.user_id,
    username: session.username,
    role: session.role,
    force_password_change: session.force_password_change,
  };

  next();
}

/**
 * Require admin role.
 */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
