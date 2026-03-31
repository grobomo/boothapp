'use strict';

// Chat API — conversational interface for session management and queries
//
// POST /api/chat        — send a message, get response
// GET  /api/chat/history — retrieve chat history
// GET  /api/chat/active  — get current active session

const { Router } = require('express');
const express = require('express');
const { S3Cache } = require('../../infra/s3-cache');

function generateSessionId() {
  // Alphanumeric, 7 chars, starts with letter
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = chars[Math.floor(Math.random() * 26)]; // start with letter
  for (let i = 1; i < 7; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function createRouter(opts) {
  const router = Router();
  const bucket = (opts && opts.bucket) || process.env.S3_BUCKET || 'boothapp-sessions-752266476357';
  const ttl = (opts && opts.ttl) || parseInt(process.env.S3_CACHE_TTL, 10) || 60000;
  const s3cache = new S3Cache({ bucket, ttl });

  // In-memory chat history (per-server lifetime, not persisted)
  const chatHistory = [];
  const MAX_HISTORY = 500;

  // Track the active session so commands like "end" and "note" work without specifying ID
  let activeSessionId = null;
  let activeSessionStart = null;

  // Valid session statuses for set_status and batch_status
  const VALID_STATUSES = ['pending', 'active', 'recording', 'completed', 'processing', 'analyzed', 'sent', 'cancelled'];

  // --- Intent detection from user message ---
  function detectIntent(message) {
    const lower = message.toLowerCase().trim();
    const trimmed = message.trim();

    // Start session: "start session for Joel Ginsberg" or "new session Joel"
    const startMatch = lower.match(/(?:start|new|begin|create)\s+(?:session|demo)\s+(?:for\s+)?(.+)/i);
    if (startMatch) {
      return { type: 'start_session', visitorName: startMatch[1].trim() };
    }

    // End session: "end A726594" or "end session"
    const endIdMatch = lower.match(/(?:end|stop|finish|close|done)\s+(?:session\s+)?([a-z0-9_-]{5,12})/i);
    if (endIdMatch) {
      return { type: 'end_session', sessionId: endIdMatch[1].toUpperCase() };
    }
    if (/^(?:end|stop|finish|close|done)(?:\s+(?:session|demo|it))?$/i.test(lower)) {
      return { type: 'end_session', sessionId: activeSessionId };
    }

    // Add notes: "note Hot lead" or "notes for A726594: follow up"
    const noteIdMatch = lower.match(/(?:note|notes?)\s+(?:for\s+)?([a-z0-9_-]{5,12})[\s:]+(.+)/i);
    if (noteIdMatch) {
      return { type: 'add_note', sessionId: noteIdMatch[1].toUpperCase(), text: noteIdMatch[2].trim() };
    }
    const noteMatch = lower.match(/(?:note|notes?)[\s:]+(.+)/i);
    if (noteMatch) {
      return { type: 'add_note', sessionId: activeSessionId, text: noteMatch[1].trim() };
    }

    // Quick-tag presets applied to active session
    if (/^(?:hot[\s-]?lead)$/i.test(lower)) {
      return { type: 'add_tag', sessionId: activeSessionId, tag: 'hot-lead' };
    }
    if (/^(?:follow[\s-]?up)$/i.test(lower)) {
      return { type: 'add_tag', sessionId: activeSessionId, tag: 'follow-up-needed' };
    }
    if (/^(?:not[\s-]?interested|cold)$/i.test(lower)) {
      return { type: 'add_tag', sessionId: activeSessionId, tag: 'not-interested' };
    }

    // Active session query
    if (/^(?:active|current|now|which session)/i.test(lower)) {
      return { type: 'active_session' };
    }

    // Switch active session: "switch to A726594"
    const switchMatch = lower.match(/(?:switch|use)\s+(?:to\s+)?(?:session\s+)?([a-z0-9_-]{5,12})/i);
    if (switchMatch) {
      return { type: 'switch_session', sessionId: switchMatch[1].toUpperCase() };
    }

    // Batch status: "mark all pending as completed" (must be before set_status)
    const batchMatch = lower.match(/(?:set|mark|change)\s+all\s+(\w+)\s+(?:to|as)\s+(\w+)/i);
    if (batchMatch && VALID_STATUSES.includes(batchMatch[1]) && VALID_STATUSES.includes(batchMatch[2])) {
      return { type: 'batch_status', from: batchMatch[1], to: batchMatch[2] };
    }

    // Set session status: "mark A726594 as completed", "set A726594 to processing"
    const statusMatch = lower.match(/(?:set|mark|change|update)\s+(?:session\s+)?([a-z0-9_-]+)\s+(?:to|as|status\s+(?:to)?)\s+(\w+)/i);
    if (statusMatch && VALID_STATUSES.includes(statusMatch[2].toLowerCase())) {
      return { type: 'set_status', sessionId: statusMatch[1].toUpperCase(), status: statusMatch[2].toLowerCase() };
    }

    // Rename visitor: "rename A726594 visitor to John Smith"
    const renameMatch = trimmed.match(/(?:rename|update)\s+(?:session\s+)?([a-z0-9_-]+)\s+(?:visitor\s+(?:to\s+)?|name\s+(?:to\s+)?)(.+)/i);
    if (renameMatch) {
      return { type: 'set_visitor', sessionId: renameMatch[1].toUpperCase(), name: renameMatch[2].trim() };
    }

    // Assign SE: "assign A726594 to Joel"
    const assignMatch = trimmed.match(/(?:assign)\s+(?:session\s+)?([a-z0-9_-]+)\s+(?:to)\s+(.+)/i);
    if (assignMatch) {
      return { type: 'assign_se', sessionId: assignMatch[1].toUpperCase(), se: assignMatch[2].trim() };
    }

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

    // Remove tag
    const untagMatch = lower.match(/(?:untag|remove\s+tag)\s+(?:session\s+)?([a-z0-9_-]+)\s+(.+)/i);
    if (untagMatch) {
      return { type: 'remove_tag', sessionId: untagMatch[1].toUpperCase(), tag: untagMatch[2].trim() };
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

    // Fallback: try to match a session ID pattern
    const idMatch = lower.match(/\b([A-Z0-9]*\d[A-Z0-9]*)\b/i);
    if (idMatch && idMatch[1].length >= 5 && idMatch[1].length <= 12) {
      return { type: 'session_detail', sessionId: idMatch[1].toUpperCase() };
    }

    return { type: 'unknown' };
  }

  // --- Build response based on intent ---
  async function buildResponse(intent) {
    switch (intent.type) {

      case 'start_session': {
        if (activeSessionId) {
          return {
            text: `Session **${activeSessionId}** is still active. End it first ("end session") or switch to a new one.`,
            data: { type: 'error', activeSessionId }
          };
        }

        const sessionId = generateSessionId();
        const now = new Date().toISOString();
        const metadata = {
          session_id: sessionId,
          visitor_name: intent.visitorName,
          started_at: now,
          ended_at: null,
          status: 'recording',
          tags: [],
          audio_consent: true,
          se_name: '',
          demo_pc: ''
        };

        try {
          await s3cache._putJson(`sessions/${sessionId}/metadata.json`, metadata);
          activeSessionId = sessionId;
          activeSessionStart = Date.now();
          return {
            text: [
              `Session **${sessionId}** started for **${intent.visitorName}**`,
              '',
              'Quick actions:',
              '- "end" when done',
              '- "note: ..." to add notes',
              '- "hot lead" / "follow up" to quick-tag',
            ].join('\n'),
            data: { type: 'session_started', sessionId, metadata }
          };
        } catch (err) {
          return { text: `Failed to create session: ${err.message}`, data: null };
        }
      }

      case 'end_session': {
        const sid = intent.sessionId;
        if (!sid) {
          return { text: 'No active session to end. Start one with "start session for [name]".', data: null };
        }

        try {
          const meta = await s3cache._getCachedJson(`sessions/${sid}/metadata.json`);
          if (!meta) {
            return { text: `Session **${sid}** not found.`, data: null };
          }

          meta.status = 'completed';
          meta.ended_at = new Date().toISOString();
          await s3cache._putJson(`sessions/${sid}/metadata.json`, meta);

          const duration = activeSessionId === sid && activeSessionStart
            ? formatDuration(Math.floor((Date.now() - activeSessionStart) / 1000))
            : 'N/A';

          if (activeSessionId === sid) {
            activeSessionId = null;
            activeSessionStart = null;
          }

          return {
            text: [
              `Session **${sid}** ended (${duration})`,
              `Visitor: **${meta.visitor_name || 'Unknown'}**`,
              `Tags: ${(meta.tags || []).join(', ') || 'none'}`,
              '',
              'Ready for next visitor. Say "start session for [name]" to begin.',
            ].join('\n'),
            data: { type: 'session_ended', sessionId: sid, duration }
          };
        } catch (err) {
          return { text: `Failed to end session: ${err.message}`, data: null };
        }
      }

      case 'add_note': {
        const sid = intent.sessionId;
        if (!sid) {
          return { text: 'No active session. Start one or specify a session ID: "note for ABC123: text"', data: null };
        }

        try {
          // Read existing notes or create new
          let notes = await s3cache._getJsonSafe(`sessions/${sid}/output/notes.json`);
          if (!notes) {
            notes = { session_id: sid, text: '', updated_at: null, updated_by: 'chat' };
          }

          // Append note with timestamp
          const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const separator = notes.text ? '\n' : '';
          notes.text += `${separator}[${timestamp}] ${intent.text}`;
          notes.updated_at = new Date().toISOString();

          await s3cache._putJson(`sessions/${sid}/output/notes.json`, notes);

          return {
            text: `Note added to session **${sid}**: "${intent.text}"`,
            data: { type: 'note_added', sessionId: sid, notes }
          };
        } catch (err) {
          return { text: `Failed to add note: ${err.message}`, data: null };
        }
      }

      case 'active_session': {
        if (!activeSessionId) {
          return { text: 'No active session. Start one with "start session for [name]".', data: null };
        }
        const elapsed = activeSessionStart
          ? formatDuration(Math.floor((Date.now() - activeSessionStart) / 1000))
          : 'N/A';
        try {
          const meta = await s3cache._getCachedJson(`sessions/${activeSessionId}/metadata.json`) || {};
          return {
            text: [
              `**Active Session: ${activeSessionId}**`,
              '',
              `| Field | Value |`,
              `|-------|-------|`,
              `| Visitor | ${meta.visitor_name || 'Unknown'} |`,
              `| Duration | ${elapsed} |`,
              `| Status | ${meta.status || 'recording'} |`,
              `| Tags | ${(meta.tags || []).join(', ') || 'none'} |`,
            ].join('\n'),
            data: { type: 'active_session', sessionId: activeSessionId, elapsed }
          };
        } catch (err) {
          return { text: `Active session: **${activeSessionId}** (${elapsed})`, data: null };
        }
      }

      case 'switch_session': {
        const sid = intent.sessionId;
        try {
          const meta = await s3cache._getCachedJson(`sessions/${sid}/metadata.json`);
          if (!meta) {
            return { text: `Session **${sid}** not found.`, data: null };
          }
          activeSessionId = sid;
          activeSessionStart = meta.started_at ? new Date(meta.started_at).getTime() : Date.now();
          return {
            text: `Switched to session **${sid}** (${meta.visitor_name || 'Unknown'})`,
            data: { type: 'session_switched', sessionId: sid }
          };
        } catch (err) {
          return { text: `Failed to switch: ${err.message}`, data: null };
        }
      }

      case 'set_status': {
        try {
          await s3cache.updateSessionField(intent.sessionId, 'status', intent.status);
          return {
            text: `Updated **${intent.sessionId}** status to **${intent.status}**.`,
            data: { type: 'status_changed', sessionId: intent.sessionId, status: intent.status }
          };
        } catch (err) {
          return { text: `Failed to update status: ${err.message}`, data: null };
        }
      }

      case 'set_visitor': {
        try {
          await s3cache.updateSessionField(intent.sessionId, 'visitor_name', intent.name);
          return {
            text: `Updated visitor name for **${intent.sessionId}** to **${intent.name}**.`,
            data: { type: 'visitor_changed', sessionId: intent.sessionId, name: intent.name }
          };
        } catch (err) {
          return { text: `Failed to update visitor: ${err.message}`, data: null };
        }
      }

      case 'assign_se': {
        try {
          await s3cache.updateSessionField(intent.sessionId, 'se_name', intent.se);
          return {
            text: `Assigned **${intent.sessionId}** to SE **${intent.se}**.`,
            data: { type: 'se_assigned', sessionId: intent.sessionId, se: intent.se }
          };
        } catch (err) {
          return { text: `Failed to assign SE: ${err.message}`, data: null };
        }
      }

      case 'batch_status': {
        try {
          const sessions = await s3cache.listSessions();
          const matching = sessions.filter(s => (s.status || '').toLowerCase() === intent.from);
          if (matching.length === 0) {
            return { text: `No sessions with status "${intent.from}" found.`, data: null };
          }
          await Promise.all(matching.map(s =>
            s3cache.updateSessionField(s.session_id, 'status', intent.to)
          ));
          return {
            text: `Updated **${matching.length}** sessions from **${intent.from}** to **${intent.to}**.`,
            data: { type: 'batch_updated', count: matching.length, from: intent.from, to: intent.to }
          };
        } catch (err) {
          return { text: `Batch update failed: ${err.message}`, data: null };
        }
      }

      case 'remove_tag': {
        const sid = intent.sessionId;
        if (!sid) {
          return { text: 'No active session. Specify a session ID: "untag ABC123 hot-lead"', data: null };
        }
        try {
          const meta = await s3cache._getCachedJson(`sessions/${sid}/metadata.json`);
          if (!meta) return { text: `Session **${sid}** not found.`, data: null };
          const tag = intent.tag.toLowerCase();
          const tags = Array.isArray(meta.tags) ? meta.tags.filter(t => t !== tag) : [];
          await s3cache.updateSessionTags(sid, tags);
          return {
            text: `Removed tag "${tag}" from session **${sid}**. Tags: ${tags.join(', ') || 'none'}`,
            data: { type: 'tag_removed', sessionId: sid, tags }
          };
        } catch (err) {
          return { text: `Failed to remove tag: ${err.message}`, data: null };
        }
      }

      case 'list_sessions': {
        const sessions = await s3cache.listSessions();
        if (sessions.length === 0) {
          return { text: 'No sessions found in the system yet.', data: null };
        }
        const lines = sessions.slice(0, 20).map(s => {
          const name = s.visitor_name || 'Unknown';
          const status = s.status || 'unknown';
          const date = s.started_at ? new Date(s.started_at).toLocaleDateString() : '';
          const active = s.session_id === activeSessionId ? ' [ACTIVE]' : '';
          return `**${s.session_id}** - ${name} (${status}) ${date}${active}`;
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
          const analysis = detail.analysis || null;
          const active = intent.sessionId === activeSessionId ? ' [ACTIVE]' : '';
          const lines = [
            `**Session ${intent.sessionId}**${active}`,
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
          if (analysis) {
            lines.push('', '**Analysis Summary:**', analysis.executive_summary || 'Not yet analyzed');
            if (analysis.session_score) {
              lines.push(`Score: **${analysis.session_score}/100**`);
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
        const sid = intent.sessionId;
        if (!sid) {
          return { text: 'No active session. Start one or specify: "tag ABC123 as hot-lead"', data: null };
        }
        try {
          const meta = await s3cache._getCachedJson(`sessions/${sid}/metadata.json`);
          if (!meta) {
            return { text: `Session **${sid}** not found.`, data: null };
          }
          const tags = Array.isArray(meta.tags) ? meta.tags : [];
          const tag = intent.tag.toLowerCase();
          if (tags.includes(tag)) {
            return { text: `Session **${sid}** already has tag "${tag}".`, data: null };
          }
          tags.push(tag);
          await s3cache.updateSessionTags(sid, tags);
          return {
            text: `Tagged session **${sid}** with "${tag}". Tags: ${tags.join(', ')}`,
            data: { type: 'tag_added', sessionId: sid, tags }
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
            activeSessionId ? `Active session: **${activeSessionId}**` : '',
            '',
            '| Status | Count |',
            '|--------|-------|',
            ...statusLines
          ].filter(Boolean).join('\n'),
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
          const active = s.session_id === activeSessionId ? ' [ACTIVE]' : '';
          return `**${s.session_id}** - ${s.visitor_name || 'Unknown'} (${ago} ago)${active}`;
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
            `| Active Session | ${activeSessionId || 'None'} |`,
            `| Uptime | ${formatDuration(uptime)} |`,
            `| Memory | ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB |`,
            `| Node | ${process.version} |`,
          ].join('\n'),
          data: { type: 'status', uptime, memory: mem, activeSessionId }
        };
      }

      case 'help':
        return {
          text: [
            '**Available Commands**',
            '',
            '**Session Management**',
            '| Command | Example |',
            '|---------|---------|',
            '| Start session | "start session for Joel" |',
            '| End session | "end" or "end A726594" |',
            '| Active session | "active" or "current" |',
            '| Switch session | "switch to A726594" |',
            '',
            '**Quick Actions (active session)**',
            '| Command | Example |',
            '|---------|---------|',
            '| Add note | "note: wants POC for XDR" |',
            '| Tag hot lead | "hot lead" |',
            '| Tag follow-up | "follow up" |',
            '| Tag not interested | "cold" |',
            '',
            '**Modify Sessions**',
            '| Command | Example |',
            '|---------|---------|',
            '| Change status | "mark A726594 as completed" |',
            '| Rename visitor | "rename A726594 visitor to John Smith" |',
            '| Assign SE | "assign A726594 to Joel" |',
            '| Batch update | "mark all pending as completed" |',
            '',
            '**Query & Search**',
            '| Command | Example |',
            '|---------|---------|',
            '| List sessions | "show sessions" |',
            '| Session details | "show A726594" |',
            '| Search by name | "find Joel" |',
            '| Add/remove tag | "tag A726594 as vip" / "untag A726594 vip" |',
            '| Recent sessions | "last 5" |',
            '| Statistics | "stats" |',
            '| System status | "status" |',
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
        active_session: activeSessionId,
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
    res.json({ messages: recent, total: chatHistory.length, active_session: activeSessionId });
  });

  // GET /api/chat/active
  router.get('/api/chat/active', (req, res) => {
    res.json({ active_session: activeSessionId, started_at: activeSessionStart });
  });

  return router;
}

module.exports = { createRouter };
