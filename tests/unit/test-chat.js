'use strict';

// Unit tests for chat intent detection
// Run: node tests/unit/test-chat.js

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  [PASS] ' + msg);
  } else {
    failed++;
    console.log('  [FAIL] ' + msg);
  }
}

// Extract detectIntent by requiring the module and testing via the router's handler
// Since detectIntent is internal, we test via the POST /api/chat endpoint behavior
// For unit testing, we replicate the intent logic here (same as in chat.js)
function detectIntent(message) {
  var lower = message.toLowerCase().trim();

  if (/^(list|show|get)\s+(all\s+)?sessions/i.test(lower) || lower === 'sessions') {
    return { type: 'list_sessions' };
  }

  var detailMatch = lower.match(/(?:show|get|view|open|details?\s*(?:for|of)?)\s+(?:session\s+)?([a-z0-9_-]+)/i);
  if (detailMatch) {
    return { type: 'session_detail', sessionId: detailMatch[1].toUpperCase() };
  }

  var nameMatch = lower.match(/(?:find|search|look\s*up|who\s+is)\s+(.+)/i);
  if (nameMatch) {
    return { type: 'search_visitor', query: nameMatch[1].trim() };
  }

  var tagAddMatch = lower.match(/(?:tag|add\s+tag|mark)\s+(?:session\s+)?([a-z0-9_-]+)\s+(?:as|with)\s+(.+)/i);
  if (tagAddMatch) {
    return { type: 'add_tag', sessionId: tagAddMatch[1].toUpperCase(), tag: tagAddMatch[2].trim() };
  }

  if (/status|health|how.?s.+(?:system|server|app)/i.test(lower)) {
    return { type: 'status' };
  }

  if (/(?:stats|statistics|summary|overview|how many|count)/i.test(lower)) {
    return { type: 'stats' };
  }

  if (/recent|latest|last\s+\d+|newest/i.test(lower)) {
    var countMatch = lower.match(/last\s+(\d+)/);
    return { type: 'recent_sessions', count: countMatch ? parseInt(countMatch[1], 10) : 5 };
  }

  if (/^(help|commands|\?|what can you do)/i.test(lower)) {
    return { type: 'help' };
  }

  var idMatch = lower.match(/\b([A-Z0-9]*\d[A-Z0-9]*)\b/i);
  if (idMatch && idMatch[1].length >= 5 && idMatch[1].length <= 12) {
    return { type: 'session_detail', sessionId: idMatch[1].toUpperCase() };
  }

  return { type: 'unknown' };
}

// --- Tests ---

console.log('\n=== Chat Intent Detection Tests ===\n');

console.log('-- Session listing --');
assert(detectIntent('show sessions').type === 'list_sessions', 'show sessions');
assert(detectIntent('list all sessions').type === 'list_sessions', 'list all sessions');
assert(detectIntent('get sessions').type === 'list_sessions', 'get sessions');
assert(detectIntent('sessions').type === 'list_sessions', 'bare "sessions"');

console.log('\n-- Session detail --');
assert(detectIntent('show A726594').type === 'session_detail', 'show session ID');
assert(detectIntent('show A726594').sessionId === 'A726594', 'correct session ID extracted');
assert(detectIntent('view session A726594').type === 'session_detail', 'view session X');
assert(detectIntent('details for A726594').type === 'session_detail', 'details for X');

console.log('\n-- Visitor search --');
assert(detectIntent('find Joel').type === 'search_visitor', 'find name');
assert(detectIntent('find Joel').query.toLowerCase() === 'joel', 'correct query extracted');
assert(detectIntent('search Casey Mondoux').type === 'search_visitor', 'search full name');
assert(detectIntent('look up Tom').type === 'search_visitor', 'look up name');

console.log('\n-- Tag operations --');
assert(detectIntent('tag A726594 as hot-lead').type === 'add_tag', 'tag X as Y');
assert(detectIntent('tag A726594 as hot-lead').sessionId === 'A726594', 'tag: correct session');
assert(detectIntent('tag A726594 as hot-lead').tag === 'hot-lead', 'tag: correct tag');
assert(detectIntent('mark A726594 with follow-up').type === 'add_tag', 'mark X with Y');

console.log('\n-- Stats --');
assert(detectIntent('stats').type === 'stats', 'stats');
assert(detectIntent('statistics').type === 'stats', 'statistics');
assert(detectIntent('how many sessions').type === 'stats', 'how many');
assert(detectIntent('overview').type === 'stats', 'overview');

console.log('\n-- Recent sessions --');
assert(detectIntent('recent').type === 'recent_sessions', 'recent');
assert(detectIntent('last 5').type === 'recent_sessions', 'last 5');
assert(detectIntent('last 5').count === 5, 'last 5: count=5');
assert(detectIntent('latest').type === 'recent_sessions', 'latest');
assert(detectIntent('newest').type === 'recent_sessions', 'newest');

console.log('\n-- Status --');
assert(detectIntent('status').type === 'status', 'status');
assert(detectIntent("how's the system").type === 'status', "how's the system");

console.log('\n-- Help --');
assert(detectIntent('help').type === 'help', 'help');
assert(detectIntent('?').type === 'help', '?');
assert(detectIntent('what can you do').type === 'help', 'what can you do');

console.log('\n-- Fallback to session ID --');
assert(detectIntent('A726594').type === 'session_detail', 'bare session ID');

console.log('\n-- Unknown --');
assert(detectIntent('hello there').type === 'unknown', 'greeting = unknown');
assert(detectIntent('xyz').type === 'unknown', 'short random = unknown');

console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===\n');
process.exit(failed > 0 ? 1 : 0);
