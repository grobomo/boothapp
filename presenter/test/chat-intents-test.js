'use strict';

// Test chat intent detection for mutation commands
// These test the new intents added for faster session changes:
// set_status, set_visitor, assign_se, batch_status

const VALID_STATUSES = ['pending', 'active', 'recording', 'completed', 'processing', 'analyzed', 'sent', 'cancelled'];

// Replicate the intent detection logic from chat.js for unit testing
function detectIntent(message) {
  const lower = message.toLowerCase().trim();
  const trimmed = message.trim();

  // Batch status (before set_status to avoid partial matches)
  const batchMatch = lower.match(/(?:set|mark|change)\s+all\s+(\w+)\s+(?:to|as)\s+(\w+)/i);
  if (batchMatch && VALID_STATUSES.includes(batchMatch[1]) && VALID_STATUSES.includes(batchMatch[2])) {
    return { type: 'batch_status', from: batchMatch[1], to: batchMatch[2] };
  }

  // Set status
  const statusMatch = lower.match(/(?:set|mark|change|update)\s+(?:session\s+)?([a-z0-9_-]+)\s+(?:to|as|status\s+(?:to)?)\s+(\w+)/i);
  if (statusMatch && VALID_STATUSES.includes(statusMatch[2].toLowerCase())) {
    return { type: 'set_status', sessionId: statusMatch[1].toUpperCase(), status: statusMatch[2].toLowerCase() };
  }

  // Rename visitor
  const renameMatch = trimmed.match(/(?:rename|update)\s+(?:session\s+)?([a-z0-9_-]+)\s+(?:visitor\s+(?:to\s+)?|name\s+(?:to\s+)?)(.+)/i);
  if (renameMatch) {
    return { type: 'set_visitor', sessionId: renameMatch[1].toUpperCase(), name: renameMatch[2].trim() };
  }

  // Assign SE
  const assignMatch = trimmed.match(/(?:assign)\s+(?:session\s+)?([a-z0-9_-]+)\s+(?:to)\s+(.+)/i);
  if (assignMatch) {
    return { type: 'assign_se', sessionId: assignMatch[1].toUpperCase(), se: assignMatch[2].trim() };
  }

  return { type: 'unknown' };
}

// --- Tests ---
let passed = 0;
let failed = 0;

function assert(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}`);
    console.log(`  expected: ${e}`);
    console.log(`  actual:   ${a}`);
    failed++;
  }
}

// Status changes
assert('mark session completed',
  detectIntent('mark A726594 as completed'),
  { type: 'set_status', sessionId: 'A726594', status: 'completed' }
);

assert('set session to active',
  detectIntent('set A726594 to active'),
  { type: 'set_status', sessionId: 'A726594', status: 'active' }
);

assert('change session to processing',
  detectIntent('change A726594 to processing'),
  { type: 'set_status', sessionId: 'A726594', status: 'processing' }
);

assert('invalid status ignored',
  detectIntent('mark A726594 as foobar'),
  { type: 'unknown' }
);

// Rename visitor (preserves case)
assert('rename visitor',
  detectIntent('rename A726594 visitor to John Smith'),
  { type: 'set_visitor', sessionId: 'A726594', name: 'John Smith' }
);

assert('update visitor name',
  detectIntent('update A726594 name to Jane Doe'),
  { type: 'set_visitor', sessionId: 'A726594', name: 'Jane Doe' }
);

// Assign SE (preserves case)
assert('assign SE',
  detectIntent('assign A726594 to Joel'),
  { type: 'assign_se', sessionId: 'A726594', se: 'Joel' }
);

assert('assign with session keyword',
  detectIntent('assign session A726594 to Casey Mondoux'),
  { type: 'assign_se', sessionId: 'A726594', se: 'Casey Mondoux' }
);

// Batch
assert('batch mark all pending as completed',
  detectIntent('mark all pending as completed'),
  { type: 'batch_status', from: 'pending', to: 'completed' }
);

assert('batch set all recording to active',
  detectIntent('set all recording to active'),
  { type: 'batch_status', from: 'recording', to: 'active' }
);

assert('batch with invalid status ignored',
  detectIntent('mark all foobar as completed'),
  { type: 'unknown' }
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
