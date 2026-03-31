const crypto = require('crypto');
const { getDb, hashPassword, verifyPassword } = require('./db');

// In-memory session store (httpOnly cookie -> user record)
const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(user) {
  const token = generateSessionToken();
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role,
    forcePasswordChange: user.force_password_change === 1,
    createdAt: Date.now()
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (Date.now() - sess.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return sess;
}

function destroySession(token) {
  sessions.delete(token);
}

// Express middleware: require authentication
function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  const sess = getSession(token);
  if (!sess) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = sess;
  next();
}

// Express middleware: require admin role
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Login handler
function login(username, password) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash, user.salt)) return null;
  return { token: createSession(user), user };
}

// Change password
function changePassword(userId, newPassword) {
  const db = getDb();
  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, salt = ?, force_password_change = 0, updated_at = datetime(\'now\') WHERE id = ?')
    .run(hash, salt, userId);
}

module.exports = { createSession, getSession, destroySession, requireAuth, requireAdmin, login, changePassword };
