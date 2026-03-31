'use strict';

// Chat API — conversational interface for session queries and changes
//
// POST /api/chat  — send a message, get AI-style response
// GET  /api/chat/history — retrieve chat history for current session

const { Router } = require('express');
const express = require('express');
const { S3Cache } = require('../../infra/s3-cache');

function createRouter(opts) {
  const router = Router();
  const bucket = (opts && opts.bucket) || process.env.S3_BUCKET || 'boothapp-sessions-752266476357';
  const ttl = (opts && opts.ttl) || parseInt(process.env.S3_CACHE_TTL, 10) || 60000;
  const s3cache = new S3Cache({ bucket, ttl });

  // In-memory chat history (per-server lifetime, not persisted)
  const chatHistory = [];
  const MAX_HISTORY = 500;

  // --- Intent detection from user message ---
  function detectIntent(message) {
    const lower = message.toLowerCase().trim();

    // Session listing
    if (/^(list|show|get)\s+(all\s+)?sessions/i.test(lower) || lower === 'sessions') {
      return { type: 'list_sessions' };
    }

    // Session detail
    const detailMatch = lower.match(/(?:show|get|view|open|details?\s*(?:for|of)?)\s+(?:session\s+)?([a-z0-9_-]+)/i);
    if (detailMatch) {
      return { type: 'session_detail', sessionId: detailMatch[1].toUpperCase() };
    }

    // Session search by visitor name
    const nameMatch = lower.match(/(?:find|search|look\s*up|who\s+is)\s+(.+)/i);
    if (nameMatch) {
      return { type: 'search_visitor', query: nameMatch[1].trim() };
    }

    // Tag operations
    const tagAddMatch = lower.match(/(?:tag|add\s+tag|mark)\s+(?:session\s+)?([a-z0-9_-]+)\s+(?:as|with)\s+(.+)/i);
    if (tagAddMatch) {
      return { type: 'add_tag', sessionId: tagAddMatch[1].toUpperCase(), tag: tagAddMatch[2].trim() };
    }

    // Status check
    if (/status|health|how.?s.+(?:system|server|app)/i.test(lower)) {
      return { type: 'status' };
    }

    // Stats / summary
    if (/(?:stats|statistics|summary|overview|how many|count)/i.test(lower)) {
      return { type: 'stats' };
    }

    // Recent sessions
    if (/recent|latest|last\s+\d+|newest/i.test(lower)) {
      const countMatch = lower.match(/last\s+(\d+)/);
      return { type: 'recent_sessions', count: countMatch ? parseInt(countMatch[1], 10) : 5 };
    }

    // Help
    if (/^(help|commands|\?|what can you do)/i.test(lower)) {
      return { type: 'help' };
    }

    // Fallback: try to match a session ID pattern (must contain at least one digit)
    const idMatch = lower.match(/\b([A-Z0-9]*\d[A-Z0-9]*)\b/i);
    if (idMatch && idMatch[1].length >= 5 && idMatch[1].length <= 12) {
      return { type: 'session_detail', sessionId: idMatch[1].toUpperCase() };
    }

    return { type: 'unknown' };
  }

  // --- Build response based on intent ---
  async function buildResponse(intent) {
    switch (intent.type) {

      case 'list_sessions': {
        const sessions = await s3cache.listSessions();
        if (sessions.length === 0) {
          return { text: 'No sessions found in the system yet.', data: null };
        }
        const lines = sessions.slice(0, 20).map(s => {
          const name = s.visitor_name || 'Unknown';
          const status = s.status || 'unknown';
          const date = s.started_at ? new Date(s.started_at).toLocaleDateString() : '';
          return `**${s.session_id}** - ${name} (${status}) ${date}`;
        });
        const more = sessions.length > 20 ? `\n\n...and ${sessions.length - 20} more` : '';
        return {
          text: `Found **${sessions.length}** sessions:\n\n${lines.join('\n')}${more}`,
          data: { type: 'session_list', sessions: sessions.slice(0, 20) }
        };
      }

      case 'session_detail': {
        try {
          const detail = await s3cache.getSessionDetail(intent.sessionId);
          const meta = detail.metadata || {};
          const output = detail.output || {};
          const lines = [
            `**Session ${intent.sessionId}**`,
            '',
            `| Field | Value |`,
            `|-------|-------|`,
            `| Visitor | ${meta.visitor_name || 'Unknown'} |`,
            `| SE | ${meta.se_name || 'N/A'} |`,
            `| Status | ${meta.status || 'unknown'} |`,
            `| Started | ${meta.started_at || 'N/A'} |`,
            `| Ended | ${meta.ended_at || 'N/A'} |`,
            `| Demo PC | ${meta.demo_pc || 'N/A'} |`,
            `| Tags | ${(meta.tags || []).join(', ') || 'none'} |`,
          ];
          if (output.summary) {
            lines.push('', '**Analysis Summary:**', output.summary.executive_summary || 'Not yet analyzed');
            if (output.summary.session_score) {
              lines.push(`Score: **${output.summary.session_score}/100**`);
            }
          }
          return {
            text: lines.join('\n'),
            data: { type: 'session_detail', session: detail }
          };
        } catch (err) {
          return { text: `Session **${intent.sessionId}** not found.`, data: null };
        }
      }

      case 'search_visitor': {
        const sessions = await s3cache.listSessions();
        const query = intent.query.toLowerCase();
        const matches = sessions.filter(s =>
          (s.visitor_name || '').toLowerCase().includes(query) ||
          (s.se_name || '').toLowerCase().includes(query) ||
          (s.session_id || '').toLowerCase().includes(query)
        );
        if (matches.length === 0) {
          return { text: `No sessions found matching "${intent.query}".`, data: null };
        }
        const lines = matches.slice(0, 10).map(s =>
          `**${s.session_id}** - ${s.visitor_name || 'Unknown'} (${s.status || 'unknown'})`
        );
        return {
          text: `Found **${matches.length}** matching sessions:\n\n${lines.join('\n')}`,
          data: { type: 'search_results', sessions: matches.slice(0, 10) }
        };
      }

      case 'add_tag': {
        try {
          const meta = await s3cache._getCachedJson(`sessions/${intent.sessionId}/metadata.json`);
          if (!meta) {
            return { text: `Session **${intent.sessionId}** not found.`, data: null };
          }
          const tags = Array.isArray(meta.tags) ? meta.tags : [];
          const tag = intent.tag.toLowerCase();
          if (tags.includes(tag)) {
            return { text: `Session **${intent.sessionId}** already has tag "${tag}".`, data: null };
          }
          tags.push(tag);
          await s3cache.updateSessionTags(intent.sessionId, tags);
          return {
            text: `Tagged session **${intent.sessionId}** with "${tag}". Tags: ${tags.join(', ')}`,
            data: { type: 'tag_added', sessionId: intent.sessionId, tags }
          };
        } catch (err) {
          return { text: `Failed to tag session: ${err.message}`, data: null };
        }
      }

      case 'stats': {
        const sessions = await s3cache.listSessions();
        const statusCounts = {};
        sessions.forEach(s => {
          const st = (s.status || 'unknown').toLowerCase();
          statusCounts[st] = (statusCounts[st] || 0) + 1;
        });
        const statusLines = Object.entries(statusCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([st, ct]) => `| ${st} | ${ct} |`);
        return {
          text: [
            `**Session Statistics**`,
            '',
            `Total sessions: **${sessions.length}**`,
            '',
            '| Status | Count |',
            '|--------|-------|',
            ...statusLines
          ].join('\n'),
          data: { type: 'stats', total: sessions.length, statusCounts }
        };
      }

      case 'recent_sessions': {
        const sessions = await s3cache.listSessions();
        const sorted = sessions
          .filter(s => s.started_at)
          .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
          .slice(0, intent.count);
        if (sorted.length === 0) {
          return { text: 'No recent sessions found.', data: null };
        }
        const lines = sorted.map(s => {
          const ago = timeSince(new Date(s.started_at));
          return `**${s.session_id}** - ${s.visitor_name || 'Unknown'} (${ago} ago)`;
        });
        return {
          text: `Last ${sorted.length} sessions:\n\n${lines.join('\n')}`,
          data: { type: 'recent_sessions', sessions: sorted }
        };
      }

      case 'status': {
        const uptime = Math.floor(process.uptime());
        const mem = process.memoryUsage();
        return {
          text: [
            '**System Status**',
            '',
            `| Metric | Value |`,
            `|--------|-------|`,
            `| Status | Online |`,
            `| Uptime | ${formatDuration(uptime)} |`,
            `| Memory | ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB |`,
            `| Node | ${process.version} |`,
          ].join('\n'),
          data: { type: 'status', uptime, memory: mem }
        };
      }

      case 'help':
        return {
          text: [
            '**Available Commands**',
            '',
            '| Command | Example |',
            '|---------|---------|',
            '| List sessions | "show sessions" |',
            '| Session details | "show A726594" |',
            '| Search by name | "find Joel" |',
            '| Add tag | "tag A726594 as hot-lead" |',
            '| Recent sessions | "last 5" |',
            '| Statistics | "stats" |',
            '| System status | "status" |',
            '',
            'Type naturally -- I\'ll figure out what you mean.',
          ].join('\n'),
          data: null
        };

      default:
        return {
          text: 'I didn\'t understand that. Try "help" to see what I can do, or just describe what you\'re looking for.',
          data: null
        };
    }
  }

  function timeSince(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }

  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  // POST /api/chat
  router.post('/api/chat', express.json(), async (req, res) => {
    const message = (req.body && req.body.message || '').trim();
    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }
    if (message.length > 1000) {
      return res.status(400).json({ error: 'message too long (max 1000 chars)' });
    }

    const start = Date.now();
    try {
      const intent = detectIntent(message);
      const response = await buildResponse(intent);
      const duration = Date.now() - start;

      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        timestamp: new Date().toISOString(),
        user_message: message,
        intent: intent.type,
        response_text: response.text,
        response_data: response.data,
        duration_ms: duration
      };

      chatHistory.push(entry);
      if (chatHistory.length > MAX_HISTORY) chatHistory.shift();

      console.log(`[chat] "${message}" -> ${intent.type} ${duration}ms`);
      res.json({
        id: entry.id,
        text: response.text,
        data: response.data,
        intent: intent.type,
        duration_ms: duration
      });
    } catch (err) {
      console.error('[chat] Error:', err.message);
      res.status(500).json({ error: 'Chat processing failed' });
    }
  });

  // GET /api/chat/history
  router.get('/api/chat/history', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_HISTORY);
    const recent = chatHistory.slice(-limit);
    res.json({ messages: recent, total: chatHistory.length });
  });

  return router;
}

module.exports = { createRouter };
