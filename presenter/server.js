const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// Load .env if present (simple key=value parser, no extra dependency)
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

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const S3_BUCKET = process.env.S3_BUCKET || 'boothapp-sessions-752266476357';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const startTime = Date.now();

// --- CORS ---
const allowedOrigins = [
  'https://boothapp.trendcyberrange.com',
  'http://localhost',
  /^http:\/\/localhost:\d+$/,
  /^chrome-extension:\/\//
];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    const allowed = allowedOrigins.some(o =>
      o instanceof RegExp ? o.test(origin) : o === origin
    );
    cb(allowed ? null : new Error('CORS not allowed'), allowed);
  },
  credentials: true
}));

// --- Security headers ---
app.use(helmet());

// --- Rate limiting: 100 requests per minute per IP ---
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' }
}));

// --- Request logging ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const ts = new Date().toISOString();
    console.log(`${ts} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// --- Health endpoint ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    sessions_count: 0,
    version: require('./package.json').version
  });
});

// --- Config endpoint ---
app.get('/api/config', (req, res) => {
  res.json({
    s3_bucket: S3_BUCKET,
    aws_region: AWS_REGION,
    port: PORT,
    node_version: process.version
  });
});

// --- Pages endpoint ---
app.get('/api/pages', (req, res) => {
  const htmlFiles = fs
    .readdirSync(__dirname)
    .filter(f => f.endsWith('.html'))
    .map(f => ({
      name: f.replace('.html', ''),
      path: '/' + f
    }));
  res.json({ pages: htmlFiles });
});

// --- JSON body parser (for /api/errors) ---
app.use(express.json({ limit: '16kb' }));

// --- Client error logging endpoint ---
const clientErrors = [];
const MAX_CLIENT_ERRORS = 200;

app.post('/api/errors', (req, res) => {
  const { message, stack, page, timestamp, userAgent } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const entry = {
    message: String(message).slice(0, 500),
    stack: String(stack || '').slice(0, 2000),
    page: String(page || '').slice(0, 500),
    timestamp: timestamp || new Date().toISOString(),
    userAgent: String(userAgent || '').slice(0, 300),
    ip: req.ip
  };

  clientErrors.push(entry);
  if (clientErrors.length > MAX_CLIENT_ERRORS) clientErrors.shift();

  console.error(`[client-error] ${entry.page} — ${entry.message}`);
  res.json({ logged: true, count: clientErrors.length });
});

app.get('/api/errors', (req, res) => {
  res.json({ errors: clientErrors, count: clientErrors.length });
});

// --- Share link API (public, no auth) ---
app.get('/api/share/:sessionId', (req, res) => {
  const sid = req.params.sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sid) return res.status(400).json({ error: 'Invalid session ID' });
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({
    session_id: sid,
    share_url: `${baseUrl}/share.html?session=${encodeURIComponent(sid)}`
  });
});

// --- Batch analysis API ---
const { createRouter: batchAnalyzeRouter } = require('./lib/batch-analyze');
app.use(batchAnalyzeRouter({ bucket: S3_BUCKET }));

// --- Screenshots API ---
const { createRouter: screenshotsRouter } = require('./lib/screenshots');
app.use(screenshotsRouter({ bucket: S3_BUCKET }));

// --- Static files ---
app.use('/analysis', express.static(path.join(__dirname, '..', 'analysis')));
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`[presenter] listening on port ${PORT}`);
  console.log(`[presenter] S3_BUCKET=${S3_BUCKET} AWS_REGION=${AWS_REGION}`);
});

module.exports = app;
