'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { validateSession, isValidISODate, isValidOffsetTimestamp, areChronological } = require('../../infra/validator');

// --- Fixtures ---

function validMetadata() {
  return {
    session_id: 'TEST1',
    visitor_name: 'Alice',
    status: 'completed',
    started_at: '2026-01-01T00:00:00Z',
    ended_at: '2026-01-01T00:30:00Z',
  };
}

function validClicks() {
  return {
    session_id: 'TEST1',
    events: [{
      timestamp: '2026-01-01T00:05:00Z',
      page_url: 'https://example.com',
      element: { tag: 'button', id: 'btn1', class: 'primary', text: 'Click me' },
    }],
  };
}

function validTranscript() {
  return {
    session_id: 'TEST1',
    entries: [{
      timestamp: '0:01:00',
      speaker: 'SE',
      text: 'Welcome to the demo',
    }],
  };
}

// --- Helper function tests ---

describe('isValidISODate', () => {
  it('accepts UTC ISO date', () => assert.ok(isValidISODate('2026-08-05T14:32:00Z')));
  it('accepts ISO with milliseconds', () => assert.ok(isValidISODate('2026-08-05T14:32:00.123Z')));
  it('rejects time offset', () => assert.ok(!isValidISODate('14:32:00')));
  it('rejects garbage', () => assert.ok(!isValidISODate('not-a-date')));
  it('rejects empty string', () => assert.ok(!isValidISODate('')));
  it('rejects null', () => assert.ok(!isValidISODate(null)));
});

describe('isValidOffsetTimestamp', () => {
  it('accepts HH:MM:SS', () => assert.ok(isValidOffsetTimestamp('00:01:30')));
  it('accepts H:MM:SS.mmm', () => assert.ok(isValidOffsetTimestamp('0:01:30.123')));
  it('rejects ISO date', () => assert.ok(!isValidOffsetTimestamp('2026-08-05T14:32:00Z')));
  it('rejects garbage', () => assert.ok(!isValidOffsetTimestamp('abc')));
});

describe('areChronological', () => {
  it('empty array is chronological', () => assert.ok(areChronological([])));
  it('single element is chronological', () => assert.ok(areChronological(['2026-01-01T00:00:00Z'])));
  it('ordered ISO dates pass', () => {
    assert.ok(areChronological(['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z']));
  });
  it('unordered ISO dates fail', () => {
    assert.ok(!areChronological(['2026-01-01T00:01:00Z', '2026-01-01T00:00:00Z']));
  });
  it('ordered offsets pass', () => {
    assert.ok(areChronological(['0:00:10', '0:01:30', '0:05:00']));
  });
  it('unordered offsets fail', () => {
    assert.ok(!areChronological(['0:05:00', '0:01:30']));
  });
});

// --- validateSession tests ---

describe('validateSession - valid data', () => {
  it('returns valid=true with no errors for complete valid session', () => {
    const r = validateSession(validMetadata(), validClicks(), validTranscript());
    assert.equal(r.valid, true);
    assert.equal(r.errors.length, 0);
  });
});

describe('validateSession - metadata errors', () => {
  it('rejects missing session_id', () => {
    const m = validMetadata();
    delete m.session_id;
    const r = validateSession(m, validClicks(), validTranscript());
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('session_id')));
  });

  it('rejects missing visitor_name', () => {
    const m = validMetadata();
    delete m.visitor_name;
    const r = validateSession(m, validClicks(), validTranscript());
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('visitor_name')));
  });

  it('rejects invalid status', () => {
    const m = validMetadata();
    m.status = 'active';
    const r = validateSession(m, validClicks(), validTranscript());
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('status')));
  });

  it('accepts status=ended', () => {
    const m = validMetadata();
    m.status = 'ended';
    const r = validateSession(m, validClicks(), validTranscript());
    assert.equal(r.valid, true);
  });

  it('rejects null metadata', () => {
    const r = validateSession(null, validClicks(), validTranscript());
    assert.equal(r.valid, false);
  });
});

describe('validateSession - clicks errors', () => {
  it('rejects empty events array', () => {
    const c = validClicks();
    c.events = [];
    const r = validateSession(validMetadata(), c, validTranscript());
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('at least 1')));
  });

  it('rejects click missing timestamp', () => {
    const c = validClicks();
    delete c.events[0].timestamp;
    const r = validateSession(validMetadata(), c, validTranscript());
    assert.equal(r.valid, false);
  });

  it('rejects click missing page_url', () => {
    const c = validClicks();
    delete c.events[0].page_url;
    const r = validateSession(validMetadata(), c, validTranscript());
    assert.equal(r.valid, false);
  });

  it('accepts url alias for page_url', () => {
    const c = validClicks();
    delete c.events[0].page_url;
    c.events[0].url = 'https://example.com';
    const r = validateSession(validMetadata(), c, validTranscript());
    assert.equal(r.valid, true);
  });

  it('rejects click missing element', () => {
    const c = validClicks();
    delete c.events[0].element;
    const r = validateSession(validMetadata(), c, validTranscript());
    assert.equal(r.valid, false);
  });

  it('rejects null clicks', () => {
    const r = validateSession(validMetadata(), null, validTranscript());
    assert.equal(r.valid, false);
  });
});

describe('validateSession - transcript errors', () => {
  it('rejects empty entries array', () => {
    const t = validTranscript();
    t.entries = [];
    const r = validateSession(validMetadata(), validClicks(), t);
    assert.equal(r.valid, false);
  });

  it('rejects entry missing speaker', () => {
    const t = validTranscript();
    delete t.entries[0].speaker;
    const r = validateSession(validMetadata(), validClicks(), t);
    assert.equal(r.valid, false);
  });

  it('rejects entry missing text', () => {
    const t = validTranscript();
    delete t.entries[0].text;
    const r = validateSession(validMetadata(), validClicks(), t);
    assert.equal(r.valid, false);
  });

  it('accepts ISO timestamp in transcript entry', () => {
    const t = validTranscript();
    t.entries[0].timestamp = '2026-01-01T00:01:00Z';
    const r = validateSession(validMetadata(), validClicks(), t);
    assert.equal(r.valid, true);
  });

  it('rejects null transcript', () => {
    const r = validateSession(validMetadata(), validClicks(), null);
    assert.equal(r.valid, false);
  });
});

describe('validateSession - warnings', () => {
  it('warns on out-of-order click timestamps', () => {
    const c = validClicks();
    c.events.push({
      timestamp: '2026-01-01T00:01:00Z', // earlier than first
      page_url: 'https://example.com/2',
      element: { tag: 'a' },
    });
    const r = validateSession(validMetadata(), c, validTranscript());
    assert.equal(r.valid, true); // warning, not error
    assert.ok(r.warnings.some(w => w.includes('chronological')));
  });

  it('warns on missing started_at', () => {
    const m = validMetadata();
    delete m.started_at;
    const r = validateSession(m, validClicks(), validTranscript());
    assert.equal(r.valid, true);
    assert.ok(r.warnings.some(w => w.includes('started_at')));
  });

  it('warns on missing ended_at', () => {
    const m = validMetadata();
    delete m.ended_at;
    const r = validateSession(m, validClicks(), validTranscript());
    assert.equal(r.valid, true);
    assert.ok(r.warnings.some(w => w.includes('ended_at')));
  });

  it('warns on invalid started_at format', () => {
    const m = validMetadata();
    m.started_at = 'not-a-date';
    const r = validateSession(m, validClicks(), validTranscript());
    assert.equal(r.valid, true);
    assert.ok(r.warnings.some(w => w.includes('started_at')));
  });
});
