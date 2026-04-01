'use strict';

// Review & Approval API routes — session follow-up workflow
//
// GET  /api/sessions/:id/review   — get review status for a session
// POST /api/sessions/:id/review   — set review status (approve/reject/pending)
// GET  /api/review/queue          — list sessions needing review

const express = require('express');
const { Router } = express;
const { S3Cache } = require('../../infra/s3-cache');

function createRouter(opts) {
  const router = Router();
  const bucket = (opts && opts.bucket) || process.env.S3_BUCKET || 'boothapp-sessions-752266476357';
  const ttl = (opts && opts.ttl) || parseInt(process.env.S3_CACHE_TTL, 10) || 60000;

  const s3cache = new S3Cache({ bucket, ttl });

  // In-memory review state (persists until server restart).
  // Production would store in S3 or a DB.
  const reviewState = {};

  // GET /api/sessions/:id/review
  router.get('/api/sessions/:id/review', async (req, res) => {
    const sessionId = req.params.id;
    if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    try {
      const state = reviewState[sessionId] || { status: 'pending', reviewer: null, reviewed_at: null, notes: '' };

      // Fetch analysis data
      let summary = null;
      let followUp = null;
      try {
        summary = await s3cache._getCachedJson(`sessions/${sessionId}/output/summary.json`);
      } catch (e) { /* no summary yet */ }
      try {
        followUp = await s3cache._getCachedJson(`sessions/${sessionId}/output/follow-up.json`);
      } catch (e) { /* no follow-up yet */ }

      res.json({
        session_id: sessionId,
        review: state,
        has_summary: !!summary,
        has_follow_up: !!followUp,
        summary: summary || null,
        follow_up: followUp || null
      });
    } catch (err) {
      console.error(`[review] Error fetching review for ${sessionId}:`, err.message);
      res.status(500).json({ error: 'Failed to fetch review' });
    }
  });

  // POST /api/sessions/:id/review
  router.post('/api/sessions/:id/review', express.json(), (req, res) => {
    const sessionId = req.params.id;
    if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const { status, reviewer, notes } = req.body || {};
    const validStatuses = ['pending', 'approved', 'rejected', 'needs_edit'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    reviewState[sessionId] = {
      status,
      reviewer: String(reviewer || 'anonymous').slice(0, 100),
      reviewed_at: new Date().toISOString(),
      notes: String(notes || '').slice(0, 2000)
    };

    console.log(`[review] ${sessionId} -> ${status} by ${reviewState[sessionId].reviewer}`);
    res.json({ session_id: sessionId, review: reviewState[sessionId] });
  });

  // GET /api/review/queue — sessions with analysis that need review
  router.get('/api/review/queue', async (req, res) => {
    try {
      const sessions = await s3cache.listSessions();

      const queue = await Promise.all(sessions.map(async (s) => {
        const st = (s.status || '').toLowerCase();
        const isCompleted = ['completed', 'ended', 'analyzed'].includes(st);
        if (!isCompleted) return null;

        const review = reviewState[s.session_id] || { status: 'pending' };

        let hasSummary = false;
        try {
          const summary = await s3cache._getCachedJson(`sessions/${s.session_id}/output/summary.json`);
          hasSummary = !!summary;
        } catch (e) { /* skip */ }

        if (!hasSummary) return null;

        return {
          session_id: s.session_id,
          visitor_name: s.visitor_name || 'Unknown',
          ended_at: s.ended_at || s.started_at,
          review_status: review.status,
          reviewer: review.reviewer || null,
          reviewed_at: review.reviewed_at || null
        };
      }));

      const filtered = queue.filter(Boolean);
      // Sort: pending first, then by date
      filtered.sort((a, b) => {
        if (a.review_status === 'pending' && b.review_status !== 'pending') return -1;
        if (a.review_status !== 'pending' && b.review_status === 'pending') return 1;
        return new Date(b.ended_at) - new Date(a.ended_at);
      });

      res.json({ queue: filtered, count: filtered.length });
    } catch (err) {
      console.error('[review] Error building queue:', err.message);
      res.status(500).json({ error: 'Failed to build review queue' });
    }
  });

  return router;
}

module.exports = { createRouter };
