const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const { requireAuth, login, changePassword, destroySession, getSession } = require('./lib/auth');
const badges = require('./lib/badges');
const sessions = require('./lib/sessions');
const events = require('./lib/events');
const demoPcs = require('./lib/demo-pcs');
const contacts = require('./lib/contacts');
const users = require('./lib/users');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 4000;
const startTime = Date.now();

// --- Cookie parser (simple, no dependency) ---
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const pair of cookieHeader.split(';')) {
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const key = pair.slice(0, eq).trim();
        const val = pair.slice(eq + 1).trim();
        req.cookies[key] = decodeURIComponent(val);
      }
    }
  }
  next();
});

// --- CORS ---
app.use(cors({
  origin: true,
  credentials: true
}));

// --- Security headers ---
app.use(helmet({
  contentSecurityPolicy: false
}));

// --- Rate limiting ---
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
}));

// --- JSON body parser ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Request logging ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ts = new Date().toISOString();
    console.log(`${ts} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// --- Health ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000), version: '1.0.0' });
});

// --- Auth endpoints (no auth required) ---
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const result = login(username, password);
  if (!result) return res.status(401).json({ error: 'Invalid credentials' });

  res.setHeader('Set-Cookie', `session=${result.token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
  res.json({
    username: result.user.username,
    role: result.user.role,
    force_password_change: result.user.force_password_change === 1
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) destroySession(token);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ logged_out: true });
});

app.post('/api/auth/change-password', (req, res) => {
  const token = req.cookies?.session;
  const sess = getSession(token);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });

  const { new_password } = req.body;
  if (!new_password || new_password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  changePassword(sess.userId, new_password);
  sess.forcePasswordChange = false;
  res.json({ changed: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.session;
  const sess = getSession(token);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    username: sess.username,
    role: sess.role,
    force_password_change: sess.forcePasswordChange
  });
});

// --- Public endpoints (no auth -- phone app, extension, packager) ---
app.use(badges.createRouter());
app.use(sessions.createRouter());
app.use(events.createPublicRouter());
app.use(demoPcs.createPublicRouter());

// --- Protected routes (require auth cookie) ---
app.use(requireAuth);
app.use(events.createRouter());
app.use(demoPcs.createRouter());
app.use(contacts.createRouter());
app.use(users.createRouter());

// --- Dashboard UI ---
app.use(express.static(path.join(__dirname, 'views')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.listen(PORT, () => {
  console.log(`[management] listening on port ${PORT}`);
  console.log(`[management] S3_BUCKET=${process.env.S3_BUCKET || 'boothapp-sessions-752266476357'}`);
});

module.exports = app;
