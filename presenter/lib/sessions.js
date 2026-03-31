'use strict';

// Session API routes — server-side S3 access with caching
//
// GET /api/sessions         — list all sessions (cached, batch ListObjectsV2)
// GET /api/sessions/:id     — session detail (parallel fetch, cached)
// GET /api/sessions/:id/files/:subfolder — list files in subfolder
// GET /api/cache-stats      — cache diagnostics

const { Router } = require('express');
const { S3Cache } = require('../../infra/s3-cache');

function createRouter(opts) {
  const router = Router();
  const bucket = (opts && opts.bucket) || process.env.S3_BUCKET || 'boothapp-sessions-752266476357';
  const ttl = (opts && opts.ttl) || parseInt(process.env.S3_CACHE_TTL, 10) || 60000;

  const s3cache = new S3Cache({ bucket, ttl });

  // Response time header middleware
  router.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      res.set('X-Response-Time', `${duration}ms`);
    });
    next();
  });

  // GET /api/sessions
  // Optional: ?include=analysis  — enriches completed sessions with summary.json fields
  router.get('/api/sessions', async (req, res) => {
    const start = Date.now();
    try {
      const sessions = await s3cache.listSessions();
      const includeAnalysis = (req.query.include || '').split(',').includes('analysis');

      let result = sessions;
      if (includeAnalysis) {
        result = await Promise.all(sessions.map(async (s) => {
          const st = (s.status || '').toLowerCase();
          const isCompleted = ['completed', 'ended', 'analyzed', 'reviewed', 'sent'].includes(st);
          if (!isCompleted) return s;
          try {
            const summary = await s3cache._getCachedJson(`sessions/${s.session_id}/output/summary.json`);
            if (summary) {
              return {
                ...s,
                session_score: summary.session_score,
                executive_summary: summary.executive_summary,
                has_analysis: true,
              };
            }
          } catch (e) { /* no analysis yet */ }
          return s;
        }));
      }

      const duration = Date.now() - start;
      console.log(`[sessions] GET /api/sessions ${result.length} sessions ${includeAnalysis ? '+analysis ' : ''}${duration}ms`);
      res.set('X-Response-Time', `${duration}ms`);
      res.json(result);
    } catch (err) {
      console.error('[sessions] Error listing sessions:', err.message);
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // GET /api/sessions/:id
  router.get('/api/sessions/:id', async (req, res) => {
    const sessionId = req.params.id;
    if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const start = Date.now();
    try {
      const detail = await s3cache.getSessionDetail(sessionId);
      const duration = Date.now() - start;
      console.log(`[sessions] GET /api/sessions/${sessionId} ${duration}ms`);
      res.set('X-Response-Time', `${duration}ms`);
      res.json(detail);
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.name === 'NoSuchBucket') {
        return res.status(404).json({ error: 'Session not found' });
      }
      console.error(`[sessions] Error fetching ${sessionId}:`, err.message);
      res.status(500).json({ error: 'Failed to fetch session' });
    }
  });

  // GET /api/sessions/:id/files/:subfolder
  router.get('/api/sessions/:id/files/:subfolder', async (req, res) => {
    const sessionId = req.params.id;
    const subfolder = req.params.subfolder;
    if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    if (!subfolder || !/^[A-Za-z0-9_-]+$/.test(subfolder)) {
      return res.status(400).json({ error: 'Invalid subfolder' });
    }

    const start = Date.now();
    try {
      const files = await s3cache.listSessionFiles(sessionId, subfolder);
      const duration = Date.now() - start;
      console.log(`[sessions] GET /api/sessions/${sessionId}/files/${subfolder} ${files.length} files ${duration}ms`);
      res.set('X-Response-Time', `${duration}ms`);
      res.json({ session_id: sessionId, subfolder, files });
    } catch (err) {
      console.error(`[sessions] Error listing files for ${sessionId}/${subfolder}:`, err.message);
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  // GET /api/cache-stats
  router.get('/api/cache-stats', (req, res) => {
    res.json(s3cache.stats());
  });

  return router;
}

module.exports = { createRouter };
