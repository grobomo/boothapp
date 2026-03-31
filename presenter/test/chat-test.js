'use strict';

// Unit tests for chat intent detection
// Run: node presenter/test/chat-test.js

// We can't import chat.js directly (needs S3), so we extract and test detectIntent logic

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error('[FAIL] ' + msg);
  }
}

// Replicate detectIntent from chat.js for unit testing
function detectIntent(message) {
  const lower = message.toLowerCase().trim();

  const startMatch = lower.match(/(?:start|new|begin|create)\s+(?:session|demo)\s+(?:for\s+)?(.+)/i);
  if (startMatch) {
    return { type: 'start_session', visitorName: startMatch[1].trim() };
  }

  const endIdMatch = lower.match(/(?:end|stop|finish|close|done)\s+(?:session\s+)?([a-z0-9_-]{5,12})/i);
  if (endIdMatch) {
    return { type: 'end_session', sessionId: endIdMatch[1].toUpperCase() };
  }
  if (/^(?:end|stop|finish|close|done)(?:\s+(?:session|demo|it))?$/i.test(lower)) {
    return { type: 'end_session', sessionId: null };
  }

  const noteIdMatch = lower.match(/(?:note|notes?)\s+(?:for\s+)?([a-z0-9_-]{5,12})[\s:]+(.+)/i);
  if (noteIdMatch) {
    return { type: 'add_note', sessionId: noteIdMatch[1].toUpperCase(), text: noteIdMatch[2].trim() };
  }
  const noteMatch = lower.match(/(?:note|notes?)[\s:]+(.+)/i);
  if (noteMatch) {
    return { type: 'add_note', sessionId: null, text: noteMatch[1].trim() };
  }

  if (/^(?:hot[\s-]?lead)$/i.test(lower)) {
    return { type: 'add_tag', sessionId: null, tag: 'hot-lead' };
  }
  if (/^(?:follow[\s-]?up)$/i.test(lower)) {
    return { type: 'add_tag', sessionId: null, tag: 'follow-up-needed' };
  }
  if (/^(?:not[\s-]?interested|cold)$/i.test(lower)) {
    return { type: 'add_tag', sessionId: null, tag: 'not-interested' };
  }

  if (/^(?:active|current|now|which session)/i.test(lower)) {
    return { type: 'active_session' };
  }

  const switchMatch = lower.match(/(?:switch|set|use)\s+(?:to\s+)?(?:session\s+)?([a-z0-9_-]{5,12})/i);
  if (switchMatch) {
    return { type: 'switch_session', sessionId: switchMatch[1].toUpperCase() };
  }

  if (/^(list|show|get)\s+(all\s+)?sessions/i.test(lower) || lower === 'sessions') {
    return { type: 'list_sessions' };
  }

  const detailMatch = lower.match(/(?:show|get|view|open|details?\s*(?:for|of)?)\s+(?:session\s+)?([a-z0-9_-]+)/i);
  if (detailMatch) {
    return { type: 'session_detail', sessionId: detailMatch[1].toUpperCase() };
  }

  const nameMatch = lower.match(/(?:find|search|look\s*up|who\s+is)\s+(.+)/i);
  if (nameMatch) {
    return { type: 'search_visitor', query: nameMatch[1].trim() };
  }

  const tagAddMatch = lower.match(/(?:tag|add\s+tag|mark)\s+(?:session\s+)?([a-z0-9_-]+)\s+(?:as|with)\s+(.+)/i);
  if (tagAddMatch) {
    return { type: 'add_tag', sessionId: tagAddMatch[1].toUpperCase(), tag: tagAddMatch[2].trim() };
  }

  const untagMatch = lower.match(/(?:untag|remove\s+tag)\s+(?:session\s+)?([a-z0-9_-]+)\s+(.+)/i);
  if (untagMatch) {
    return { type: 'remove_tag', sessionId: untagMatch[1].toUpperCase(), tag: untagMatch[2].trim() };
  }

  if (/status|health|how.?s.+(?:system|server|app)/i.test(lower)) {
    return { type: 'status' };
  }

  if (/(?:stats|statistics|summary|overview|how many|count)/i.test(lower)) {
    return { type: 'stats' };
  }

  if (/recent|latest|last\s+\d+|newest/i.test(lower)) {
    const countMatch = lower.match(/last\s+(\d+)/);
    return { type: 'recent_sessions', count: countMatch ? parseInt(countMatch[1], 10) : 5 };
  }

  if (/^(help|commands|\?|what can you do)/i.test(lower)) {
    return { type: 'help' };
  }

  const idMatch = lower.match(/\b([A-Z0-9]*\d[A-Z0-9]*)\b/i);
  if (idMatch && idMatch[1].length >= 5 && idMatch[1].length <= 12) {
    return { type: 'session_detail', sessionId: idMatch[1].toUpperCase() };
  }

  return { type: 'unknown' };
}

// --- Session management tests ---
console.log('=== Session Management ===');

let r = detectIntent('start session for Joel Ginsberg');
assert(r.type === 'start_session', 'start session detected');
assert(r.visitorName === 'joel ginsberg', 'visitor name extracted: ' + r.visitorName);

r = detectIntent('new demo for Sarah Chen');
assert(r.type === 'start_session', 'new demo detected');

r = detectIntent('end session');
assert(r.type === 'end_session', 'end session detected');

r = detectIntent('end');
assert(r.type === 'end_session', 'bare "end" detected');

r = detectIntent('done');
assert(r.type === 'end_session', 'bare "done" detected');

r = detectIntent('stop demo');
assert(r.type === 'end_session', 'stop demo detected');

r = detectIntent('end A726594');
assert(r.type === 'end_session', 'end with ID detected');
assert(r.sessionId === 'A726594', 'session ID extracted');

// --- Notes tests ---
console.log('=== Notes ===');

r = detectIntent('note: wants POC for XDR');
assert(r.type === 'add_note', 'note detected');
assert(r.text === 'wants poc for xdr', 'note text: ' + r.text);

r = detectIntent('note for A726594: follow up Friday');
assert(r.type === 'add_note', 'note with ID detected');
assert(r.sessionId === 'A726594', 'note session ID');

// --- Quick tags ---
console.log('=== Quick Tags ===');

r = detectIntent('hot lead');
assert(r.type === 'add_tag' && r.tag === 'hot-lead', 'hot lead quick tag');

r = detectIntent('follow up');
assert(r.type === 'add_tag' && r.tag === 'follow-up-needed', 'follow up quick tag');

r = detectIntent('cold');
assert(r.type === 'add_tag' && r.tag === 'not-interested', 'cold quick tag');

// --- Active/switch ---
console.log('=== Active/Switch ===');

r = detectIntent('active');
assert(r.type === 'active_session', 'active query');

r = detectIntent('current');
assert(r.type === 'active_session', 'current query');

r = detectIntent('switch to A726594');
assert(r.type === 'switch_session' && r.sessionId === 'A726594', 'switch session');

// --- Existing commands still work ---
console.log('=== Existing Commands ===');

r = detectIntent('show sessions');
assert(r.type === 'list_sessions', 'list sessions');

r = detectIntent('find Joel');
assert(r.type === 'search_visitor', 'search visitor');

r = detectIntent('tag A726594 as vip');
assert(r.type === 'add_tag' && r.tag === 'vip', 'tag with ID');

r = detectIntent('untag A726594 vip');
assert(r.type === 'remove_tag', 'remove tag');

r = detectIntent('stats');
assert(r.type === 'stats', 'stats');

r = detectIntent('last 5');
assert(r.type === 'recent_sessions' && r.count === 5, 'recent sessions');

r = detectIntent('help');
assert(r.type === 'help', 'help');

r = detectIntent('status');
assert(r.type === 'status', 'status');

// --- Results ---
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
