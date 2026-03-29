#!/usr/bin/env node
// Unit tests for analysis/lib/correlator.js
// Tests derived from ana-02-correlator.json spec:
//   1. Click at 00:05:30 + transcript entry at 00:05:28 -> correctly correlated
//   2. Timeline is sorted chronologically
//   3. Screenshots referenced in timeline exist (verified structurally; S3 check is integration)
//   4. Session with no clicks (audio only) -> timeline still valid
//   5. Session with no audio (clicks only) -> timeline still valid

'use strict';

const { correlate, parseOffset } = require('../lib/correlator');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SESSION_START = '2026-08-05T14:32:00.000Z'; // 00:00:00

// Metadata
const metadata = {
  session_id: 'A726594',
  started_at: SESSION_START,
  status: 'completed',
};

// Transcript: entries at 00:05:28 and 00:00:03
const transcript = {
  session_id: 'A726594',
  source: 'recording.wav',
  duration_seconds: 900,
  entries: [
    { timestamp: '00:00:03.000', speaker: 'SE',      text: 'Welcome, let me show you Vision One.' },
    { timestamp: '00:05:28.000', speaker: 'Visitor',  text: 'Tell me about BYOD policy.' },
    { timestamp: '00:07:00.000', speaker: 'SE',       text: 'Sure, here is how BYOD policies work.' },
  ],
};

// Clicks: one click at 00:05:30 (2 seconds after the 00:05:28 transcript entry)
function absTime(offsetSeconds) {
  return new Date(new Date(SESSION_START).getTime() + offsetSeconds * 1000).toISOString();
}

const clicks = {
  session_id: 'A726594',
  events: [
    {
      index: 1,
      timestamp: absTime(15),        // 00:00:15 — during the welcome speech
      type: 'click',
      dom_path: 'nav > a.dashboard',
      element: { tag: 'a', text: 'Dashboard' },
      coordinates: { x: 100, y: 50 },
      page_url: 'https://portal.xdr.example.com/dashboard',
      page_title: 'Vision One - Dashboard',
      screenshot_file: 'screenshots/click-001.jpg',
    },
    {
      index: 2,
      timestamp: absTime(330),       // 00:05:30 — 2 seconds after 00:05:28 Visitor speech
      type: 'click',
      dom_path: 'div.byod-policy > button.configure',
      element: { tag: 'button', text: 'Configure BYOD' },
      coordinates: { x: 450, y: 320 },
      page_url: 'https://portal.xdr.example.com/endpoint/byod',
      page_title: 'Vision One - BYOD Policy',
      screenshot_file: 'screenshots/click-002.jpg',
    },
  ],
};

// ─── Test 1: Click at 00:05:30 correlated with transcript entry at 00:05:28 ─

console.log('\nTest 1: Click at 00:05:30 correlated with transcript entry at 00:05:28');
{
  const result = correlate(metadata, clicks, transcript);
  const clickEvent = result.timeline.find((e) => e.type === 'click' && e.index === 2);

  assert(clickEvent !== undefined, 'click index 2 present in timeline');
  assert(
    clickEvent.speech_at_moment !== null,
    'click has speech_at_moment'
  );
  assert(
    clickEvent.speech_at_moment?.timestamp_offset === '00:05:28.000',
    `speech_at_moment is the 00:05:28 entry (got: ${clickEvent.speech_at_moment?.timestamp_offset})`
  );
  assert(
    clickEvent.speech_at_moment?.speaker === 'Visitor',
    `speech_at_moment speaker is Visitor (got: ${clickEvent.speech_at_moment?.speaker})`
  );
  assert(
    clickEvent.speech_at_moment?.text === 'Tell me about BYOD policy.',
    `speech_at_moment text matches (got: "${clickEvent.speech_at_moment?.text}")`
  );

  // The 00:05:28 speech entry should list click-002 in clicks_during
  const speechEntry = result.timeline.find(
    (e) => e.type === 'speech' && e.timestamp_offset === '00:05:28.000'
  );
  assert(speechEntry !== undefined, '00:05:28 speech entry in timeline');
  assert(
    speechEntry.clicks_during.some((c) => c.index === 2),
    'click-002 listed in clicks_during of 00:05:28 speech entry'
  );
}

// ─── Test 2: Timeline is sorted chronologically ───────────────────────────

console.log('\nTest 2: Timeline is sorted chronologically');
{
  const result = correlate(metadata, clicks, transcript);
  let sorted = true;
  for (let i = 1; i < result.timeline.length; i++) {
    const prev = new Date(result.timeline[i - 1].timestamp).getTime();
    const curr = new Date(result.timeline[i].timestamp).getTime();
    if (curr < prev) {
      sorted = false;
      console.error(`    Out of order: ${result.timeline[i - 1].timestamp} > ${result.timeline[i].timestamp}`);
      break;
    }
  }
  assert(sorted, 'all timeline events are in non-decreasing timestamp order');
  assert(
    result.timeline.length === clicks.events.length + transcript.entries.length,
    `event_count matches (${result.timeline.length} = ${clicks.events.length} clicks + ${transcript.entries.length} speech)`
  );
}

// ─── Test 3: Screenshots referenced in timeline (structural check) ────────

console.log('\nTest 3: Screenshots referenced in timeline are structurally valid paths');
{
  const result = correlate(metadata, clicks, transcript);
  const clicksWithScreenshots = result.timeline.filter(
    (e) => e.type === 'click' && e.screenshot !== null
  );
  assert(
    clicksWithScreenshots.length === clicks.events.length,
    'every click event has a screenshot reference'
  );
  for (const ev of clicksWithScreenshots) {
    assert(
      typeof ev.screenshot === 'string' && ev.screenshot.startsWith('screenshots/'),
      `click ${ev.index} screenshot path is valid: "${ev.screenshot}"`
    );
  }

  // Speech entries after the first click should have a screenshot reference
  const speechAfterFirstClick = result.timeline.find(
    (e) => e.type === 'speech' && e.timestamp_offset === '00:05:28.000'
  );
  assert(
    speechAfterFirstClick?.screenshot === 'screenshots/click-001.jpg',
    `speech at 00:05:28 inherits nearest preceding click screenshot (got: "${speechAfterFirstClick?.screenshot}")`
  );
}

// ─── Test 4: Session with no clicks (audio only) ─────────────────────────

console.log('\nTest 4: Session with no clicks (audio only) -> timeline still valid');
{
  const emptyCLicks = { session_id: 'A726594', events: [] };
  const result = correlate(metadata, emptyCLicks, transcript);

  assert(result.session_id === 'A726594', 'session_id preserved');
  assert(result.click_count === 0, 'click_count is 0');
  assert(result.speech_count === transcript.entries.length, `speech_count is ${transcript.entries.length}`);
  assert(result.event_count === transcript.entries.length, 'event_count equals speech entries');
  assert(Array.isArray(result.timeline), 'timeline is an array');
  assert(
    result.timeline.every((e) => e.type === 'speech'),
    'all events are speech type'
  );
  assert(
    result.timeline.every((e) => Array.isArray(e.clicks_during) && e.clicks_during.length === 0),
    'all speech entries have empty clicks_during'
  );
}

// ─── Test 5: Session with no audio (clicks only) ─────────────────────────

console.log('\nTest 5: Session with no audio (clicks only) -> timeline still valid');
{
  const emptyTranscript = {
    session_id: 'A726594',
    source: 'recording.wav',
    duration_seconds: 900,
    entries: [],
  };
  const result = correlate(metadata, clicks, emptyTranscript);

  assert(result.session_id === 'A726594', 'session_id preserved');
  assert(result.speech_count === 0, 'speech_count is 0');
  assert(result.click_count === clicks.events.length, `click_count is ${clicks.events.length}`);
  assert(result.event_count === clicks.events.length, 'event_count equals click events');
  assert(Array.isArray(result.timeline), 'timeline is an array');
  assert(
    result.timeline.every((e) => e.type === 'click'),
    'all events are click type'
  );
  assert(
    result.timeline.every((e) => e.speech_at_moment === null),
    'all clicks have null speech_at_moment'
  );
}

// ─── Bonus: parseOffset helper ───────────────────────────────────────────

console.log('\nBonus: parseOffset timestamp parsing');
{
  assert(parseOffset('00:00:03.000') === 3,        'parses 00:00:03.000 -> 3s');
  assert(parseOffset('00:05:28.000') === 328,      'parses 00:05:28.000 -> 328s');
  assert(parseOffset('00:05:30.500') === 330.5,    'parses 00:05:30.500 -> 330.5s');
  assert(parseOffset('01:00:00.000') === 3600,     'parses 01:00:00.000 -> 3600s');
}

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
