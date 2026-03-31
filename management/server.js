'use strict';

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const badgeRoutes = require('./routes/badges');
const sessionRoutes = require('./routes/sessions');
const demoPcRoutes = require('./routes/demo-pcs');
const contactRoutes = require('./routes/contacts');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 4000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS for extension and mobile app
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Static files for dashboard
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/badges', badgeRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/demo-pcs', demoPcRoutes);
app.use('/api/contacts', contactRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
  });
});

// Dashboard SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CaseyApp Management Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
