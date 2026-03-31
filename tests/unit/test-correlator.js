'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  correlate,
  parseOffset,
  detectTopics,
  computeEngagement,
  findNearestScreenshot,
  buildScreenshotIndex,
  normalizeClicks,
  normalizeTranscript,
} = require('../../analysis/lib/correlator');

// --- Fixtures ---

const STARTED_AT = '2026-03-29T10:00:00.000Z';
const START_MS = new Date(STARTED_AT).getTime();

function makeMetadata(overrides) {
  return Object.assign({ session_id: 'sess-001', started_at: STARTED_AT }, overrides);
}

function makeClicks() {
  return {
    events: [
      {
        index: 1,
        timestamp: '2026-03-29T10:00:05.000Z',
        dom_path: 'body>div>button.endpoint-security',
        element: 'Endpoint Security',
        coordinates: { x: 100, y: 200 },
        page_url: 'https://portal.xdr.trendmicro.com/app/endpoint-security',
        page_title: 'Vision One - Endpoint Security',
        screenshot_file: 'shot-001.png',
      },
      {
        index: 2,
        timestamp: '2026-03-29T10:00:12.000Z',
        dom_path: 'body>div>a.xdr-workbench',
        element: 'XDR Workbench',
        coordinates: { x: 300, y: 400 },
        page_url: 'https://portal.xdr.trendmicro.com/app/xdr',
        page_title: 'Vision One - XDR Workbench',
        screenshot_file: 'shot-002.png',
      },
    ],
  };
}

function makeTranscript() {
  return {
    duration_seconds: 20,
    entries: [
      { timestamp: '00:00:03.000', speaker: 'SE', text: 'Let me show you the dashboard and risk insights' },
      { timestamp: '00:00:08.000', speaker: 'Visitor', text: 'How does the endpoint detection work?' },
      { timestamp: '00:00:15.000', speaker: 'SE', text: 'And here is the XDR workbench for threat hunting' },
    ],
  };
}

function makeScreenshots() {
  return [
    { filename: 'periodic-001.jpg', timestamp: '2026-03-29T10:00:02.000Z' },
    { filename: 'click-001.jpg', timestamp: '2026-03-29T10:00:05.200Z' },
    { filename: 'periodic-002.jpg', timestamp: '2026-03-29T10:00:07.000Z' },
    { filename: 'click-002.jpg', timestamp: '2026-03-29T10:00:12.100Z' },
    { filename: 'periodic-003.jpg', timestamp: '2026-03-29T10:00:16.000Z' },
  ];
}

// --- parseOffset ---

describe('parseOffset', () => {
  it('parses HH:MM:SS.mmm', () => {
    assert.equal(parseOffset('00:01:30.500'), 90.5);
  });

  it('parses HH:MM:SS without fractional', () => {
    assert.equal(parseOffset('01:00:00'), 3600);
  });

  it('parses MM:SS (two-part)', () => {
    assert.equal(parseOffset('05:30'), 330);
  });

  it('returns 0 for 00:00:00.000', () => {
    assert.equal(parseOffset('00:00:00.000'), 0);
  });
});

// --- normalizeClicks ---

describe('normalizeClicks', () => {
  it('returns events array from { events: [] }', () => {
    const result = normalizeClicks({ events: [{ a: 1 }] });
    assert.deepStrictEqual(result, [{ a: 1 }]);
  });

  it('returns clicks array from { clicks: [] }', () => {
    const result = normalizeClicks({ clicks: [{ b: 2 }] });
    assert.deepStrictEqual(result, [{ b: 2 }]);
  });

  it('returns top-level array as-is', () => {
    const arr = [{ c: 3 }];
    assert.deepStrictEqual(normalizeClicks(arr), arr);
  });

  it('returns [] for null', () => {
    assert.deepStrictEqual(normalizeClicks(null), []);
  });

  it('returns [] for empty object', () => {
    assert.deepStrictEqual(normalizeClicks({}), []);
  });
});

// --- normalizeTranscript ---

describe('normalizeTranscript', () => {
  it('handles { entries: [] }', () => {
    const r = normalizeTranscript({ entries: [{ x: 1 }], duration_seconds: 10 });
    assert.deepStrictEqual(r.entries, [{ x: 1 }]);
    assert.equal(r.duration_seconds, 10);
  });

  it('handles { results: [] }', () => {
    const r = normalizeTranscript({ results: [{ x: 2 }] });
    assert.deepStrictEqual(r.entries, [{ x: 2 }]);
  });

  it('handles { items: [] }', () => {
    const r = normalizeTranscript({ items: [{ x: 3 }] });
    assert.deepStrictEqual(r.entries, [{ x: 3 }]);
  });

  it('handles { transcripts: [] }', () => {
    const r = normalizeTranscript({ transcripts: [{ x: 4 }] });
    assert.deepStrictEqual(r.entries, [{ x: 4 }]);
  });

  it('handles top-level array', () => {
    const r = normalizeTranscript([{ x: 5 }]);
    assert.deepStrictEqual(r.entries, [{ x: 5 }]);
    assert.equal(r.duration_seconds, null);
  });

  it('handles null', () => {
    const r = normalizeTranscript(null);
    assert.deepStrictEqual(r.entries, []);
    assert.equal(r.duration_seconds, null);
  });
});

// --- buildScreenshotIndex & findNearestScreenshot ---

describe('buildScreenshotIndex', () => {
  it('returns sorted array with _tsMs and offset_seconds', () => {
    const idx = buildScreenshotIndex(makeScreenshots(), START_MS);
    assert.equal(idx.length, 5);
    assert.equal(idx[0].filename, 'periodic-001.jpg');
    assert.equal(idx[0].offset_seconds, 2);
    // sorted ascending
    for (let i = 1; i < idx.length; i++) {
      assert.ok(idx[i]._tsMs >= idx[i - 1]._tsMs);
    }
  });

  it('returns [] for empty/null input', () => {
    assert.deepStrictEqual(buildScreenshotIndex([], START_MS), []);
    assert.deepStrictEqual(buildScreenshotIndex(null, START_MS), []);
  });
});

describe('findNearestScreenshot', () => {
  const idx = buildScreenshotIndex(makeScreenshots(), START_MS);

  it('finds exact match', () => {
    const match = findNearestScreenshot(idx, new Date('2026-03-29T10:00:05.200Z').getTime());
    assert.equal(match.filename, 'click-001.jpg');
  });

  it('finds closest within default 5s window', () => {
    const match = findNearestScreenshot(idx, new Date('2026-03-29T10:00:06.000Z').getTime());
    assert.ok(match !== null);
  });

  it('returns null when too far from any screenshot', () => {
    const match = findNearestScreenshot(idx, new Date('2026-03-29T10:00:30.000Z').getTime());
    assert.equal(match, null);
  });

  it('returns null for empty index', () => {
    assert.equal(findNearestScreenshot([], START_MS), null);
  });

  it('respects custom maxGapMs', () => {
    // 100ms gap -- click-001.jpg is at T+5.2s, query at T+5.5s = 300ms gap
    const match = findNearestScreenshot(idx, new Date('2026-03-29T10:00:05.500Z').getTime(), 100);
    assert.equal(match, null);
  });
});

// --- detectTopics ---

describe('detectTopics', () => {
  it('detects topics from click page_url and page_title', () => {
    const clicks = [
      { offset_seconds: 5, page_url: 'https://example.com/endpoint-security', page_title: 'Endpoint', dom_path: null, element: null },
    ];
    const topics = detectTopics(clicks, []);
    const names = topics.map(t => t.topic);
    assert.ok(names.includes('Endpoint Security'));
  });

  it('detects topics from speech text', () => {
    const speech = [
      { offset_seconds: 3, text: 'Let me show you the XDR workbench', speaker: 'SE' },
    ];
    const topics = detectTopics([], speech);
    const names = topics.map(t => t.topic);
    assert.ok(names.includes('XDR'));
  });

  it('returns empty for no matching content', () => {
    const topics = detectTopics(
      [{ offset_seconds: 0, page_url: 'https://example.com', page_title: 'Home', dom_path: null, element: null }],
      []
    );
    assert.equal(topics.length, 0);
  });

  it('sorts by mentions descending', () => {
    const clicks = [
      { offset_seconds: 1, page_url: 'https://example.com/xdr', page_title: 'XDR Detection', dom_path: null, element: null },
      { offset_seconds: 2, page_url: 'https://example.com/xdr', page_title: 'XDR Workbench', dom_path: null, element: null },
      { offset_seconds: 3, page_url: 'https://example.com/endpoint', page_title: 'Endpoint', dom_path: null, element: null },
    ];
    const topics = detectTopics(clicks, []);
    assert.equal(topics[0].topic, 'XDR');
    assert.ok(topics[0].mentions >= topics[topics.length - 1].mentions);
  });

  it('includes evidence sources', () => {
    const clicks = [{ offset_seconds: 5, page_url: 'https://example.com/endpoint', page_title: null, dom_path: null, element: null }];
    const topics = detectTopics(clicks, []);
    const ep = topics.find(t => t.topic === 'Endpoint Security');
    assert.ok(ep.evidence.includes('click:page_url'));
  });
});

// --- computeEngagement ---

describe('computeEngagement', () => {
  it('returns 0 for empty inputs', () => {
    assert.equal(computeEngagement([], [], 0, 0), 0);
  });

  it('returns score in 0-10 range', () => {
    const clicks = Array.from({ length: 10 }, (_, i) => ({ offset_seconds: i }));
    const speech = [
      { text: 'How does this work?', speaker: 'Visitor' },
      { text: 'Great question', speaker: 'SE' },
    ];
    const score = computeEngagement(clicks, speech, 300, 3);
    assert.ok(score >= 0 && score <= 10, `score ${score} out of range`);
    assert.ok(score > 0, 'active session should score > 0');
  });

  it('higher engagement produces higher score', () => {
    const lowClicks = [{ offset_seconds: 0 }];
    const highClicks = Array.from({ length: 20 }, (_, i) => ({ offset_seconds: i * 3 }));
    const speech = [
      { text: 'What about this?', speaker: 'Visitor' },
      { text: 'And this?', speaker: 'Visitor' },
      { text: 'Can you show me?', speaker: 'Visitor' },
    ];
    const low = computeEngagement(lowClicks, [], 60, 0);
    const high = computeEngagement(highClicks, speech, 600, 5);
    assert.ok(high > low, `high ${high} should be > low ${low}`);
  });
});

// --- correlate (full integration) ---

describe('correlate', () => {
  it('produces correct output structure with clicks + transcript', () => {
    const result = correlate(makeMetadata(), makeClicks(), makeTranscript());

    assert.equal(result.session_id, 'sess-001');
    assert.equal(result.started_at, STARTED_AT);
    assert.equal(result.click_count, 2);
    assert.equal(result.speech_count, 3);
    assert.equal(result.event_count, 5);
    assert.equal(result.duration_seconds, 20);
    assert.ok(Array.isArray(result.timeline));
    assert.equal(result.timeline.length, 5);
    assert.ok(typeof result.engagement_score === 'number');
    assert.ok(Array.isArray(result.topics_detected));
    assert.ok(result.generated_at);
    assert.equal(result.error, undefined);
  });

  it('timeline is sorted chronologically', () => {
    const result = correlate(makeMetadata(), makeClicks(), makeTranscript());
    for (let i = 1; i < result.timeline.length; i++) {
      assert.ok(
        result.timeline[i].offset_seconds >= result.timeline[i - 1].offset_seconds,
        `event ${i} offset ${result.timeline[i].offset_seconds} < previous ${result.timeline[i - 1].offset_seconds}`
      );
    }
  });

  it('click events have speech_at_moment cross-reference', () => {
    const result = correlate(makeMetadata(), makeClicks(), makeTranscript());
    const clickEvts = result.timeline.filter(e => e.type === 'click');
    // First click at T+5s should reference speech at T+3s
    assert.ok(clickEvts[0].speech_at_moment !== null);
    assert.equal(clickEvts[0].speech_at_moment.speaker, 'SE');
  });

  it('speech events have clicks_during cross-reference', () => {
    const result = correlate(makeMetadata(), makeClicks(), makeTranscript());
    const speechEvts = result.timeline.filter(e => e.type === 'speech');
    // Speech at T+3s window [3s..8s) contains click at T+5s
    const speechAt3 = speechEvts.find(e => e.offset_seconds === 3);
    assert.ok(speechAt3.clicks_during.length >= 1);
    assert.equal(speechAt3.clicks_during[0].index, 1);
  });

  it('handles clicks only (no transcript)', () => {
    const result = correlate(makeMetadata(), makeClicks(), { entries: [], duration_seconds: 0 });
    assert.equal(result.click_count, 2);
    assert.equal(result.speech_count, 0);
    assert.equal(result.event_count, 2);
    assert.equal(result.error, undefined);
  });

  it('handles transcript only (no clicks)', () => {
    const result = correlate(makeMetadata(), { events: [] }, makeTranscript());
    assert.equal(result.click_count, 0);
    assert.equal(result.speech_count, 3);
    assert.equal(result.event_count, 3);
    assert.equal(result.error, undefined);
  });

  it('handles null inputs gracefully (empty timeline)', () => {
    const result = correlate(makeMetadata(), null, null);
    assert.equal(result.event_count, 0);
    assert.deepStrictEqual(result.timeline, []);
    assert.equal(result.engagement_score, 0);
    assert.equal(result.error, undefined);
  });

  it('handles null metadata gracefully', () => {
    const result = correlate(null, makeClicks(), makeTranscript());
    assert.equal(result.session_id, 'unknown');
    assert.equal(result.timeline.length, 5);
  });

  it('attaches matched screenshots to events', () => {
    const result = correlate(makeMetadata(), makeClicks(), makeTranscript(), makeScreenshots());
    const click1 = result.timeline.find(e => e.type === 'click' && e.index === 1);
    assert.ok(click1.matched_screenshots.length >= 1);
    assert.equal(click1.matched_screenshots[0].filename, 'click-001.jpg');
  });

  it('timeline events do not contain internal _tsMs field', () => {
    const result = correlate(makeMetadata(), makeClicks(), makeTranscript());
    for (const ev of result.timeline) {
      assert.equal(ev._tsMs, undefined, `event should not have _tsMs`);
    }
  });

  it('detects product topics in output', () => {
    const result = correlate(makeMetadata(), makeClicks(), makeTranscript());
    const topicNames = result.topics_detected.map(t => t.topic);
    assert.ok(topicNames.includes('Endpoint Security'));
    assert.ok(topicNames.includes('XDR'));
  });

  it('handles malformed inputs without crashing', () => {
    const result = correlate({}, {}, {});
    assert.equal(result.event_count, 0);
    assert.equal(result.session_id, 'unknown');
    assert.ok(Array.isArray(result.timeline));
  });
});
