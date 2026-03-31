const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
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
    // Allow requests with no origin (curl, server-to-server)
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

// --- Static files ---
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Presenter server listening on port ${PORT}`);
});

module.exports = app;
