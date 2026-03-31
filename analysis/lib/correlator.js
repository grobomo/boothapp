'use strict';

// Timestamp correlator: merges clicks.json + transcript.json + screenshots into a unified timeline.
// Pure function — no S3 or file I/O.  pipeline-run.js handles data fetching.

var SCREENSHOT_MATCH_WINDOW_MS = 2000; // 2-second window for matching screenshots to clicks
var SEGMENT_DURATION_S = 30; // 30-second segments for engagement scoring

var PRODUCT_TOPICS = [
  { keyword: 'xdr', topic: 'XDR' },
  { keyword: 'endpoint', topic: 'Endpoint' },
  { keyword: 'ztsa', topic: 'ZTSA' },
  { keyword: 'zero trust', topic: 'Zero Trust' },
  { keyword: 'cloud', topic: 'Cloud' },
  { keyword: 'email', topic: 'Email' },
  { keyword: 'network', topic: 'Network' },
  { keyword: 'container', topic: 'Container' },
  { keyword: 'detection', topic: 'Detection' },
  { keyword: 'response', topic: 'Response' },
];

// Parse transcript offset "HH:MM:SS.mmm" -> total seconds, or NaN if invalid
function parseOffset(ts) {
  if (typeof ts !== 'string' || ts.length === 0) return NaN;
  const dotIdx = ts.indexOf('.');
  const fractional = dotIdx >= 0 ? Number('0.' + ts.slice(dotIdx + 1)) : 0;
  const hms = dotIdx >= 0 ? ts.slice(0, dotIdx) : ts;
  const parts = hms.split(':').map(Number);
  const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
  return h * 3600 + m * 60 + s + fractional;
}

// Add fractional seconds to an ISO date string -> new ISO date string
function addSeconds(isoDate, seconds) {
  return new Date(new Date(isoDate).getTime() + seconds * 1000).toISOString();
}

// Match screenshot files to click events by timestamp (within 2s window).
// screenshots: [{ file: 'click-001.jpg', timestamp: 'ISO' }, ...]
function matchScreenshots(clickEvents, screenshots) {
  if (!screenshots || !Array.isArray(screenshots) || screenshots.length === 0) return;
  for (var i = 0; i < clickEvents.length; i++) {
    var clickMs = clickEvents[i]._tsMs;
    var best = null;
    var bestDelta = Infinity;
    for (var j = 0; j < screenshots.length; j++) {
      var ssMs = new Date(screenshots[j].timestamp).getTime();
      var delta = Math.abs(ssMs - clickMs);
      if (delta <= SCREENSHOT_MATCH_WINDOW_MS && delta < bestDelta) {
        bestDelta = delta;
        best = screenshots[j];
      }
    }
    if (best) {
      clickEvents[i].screenshot_url = best.file || best.url || null;
    }
  }
}

// Detect product topics from a combined text string (URLs + transcript text).
function detectTopics(text) {
  if (!text) return [];
  var lower = text.toLowerCase();
  var found = [];
  for (var i = 0; i < PRODUCT_TOPICS.length; i++) {
    if (lower.indexOf(PRODUCT_TOPICS[i].keyword) !== -1) {
      found.push(PRODUCT_TOPICS[i].topic);
    }
  }
  return found;
}

// Calculate engagement score (0-10) for a segment based on click density + dialogue activity.
// clickCount: number of clicks in segment
// speechCount: number of speech events in segment
// segmentDurationS: duration of the segment in seconds
function calcEngagementScore(clickCount, speechCount, segmentDurationS) {
  if (segmentDurationS <= 0) return 0;
  // click density: clicks per 30s, capped contribution at 5
  var clickScore = Math.min((clickCount / segmentDurationS) * 30, 5);
  // dialogue activity: speech events per 30s, capped contribution at 5
  var speechScore = Math.min((speechCount / segmentDurationS) * 30, 5);
  return Math.round((clickScore + speechScore) * 10) / 10;
}

// Build enriched segments with engagement_score, topics[], screenshot_refs[].
function buildSegments(allEvents, durationSeconds) {
  if (!allEvents || allEvents.length === 0) return [];
  var duration = durationSeconds || 0;
  if (duration <= 0 && allEvents.length > 0) {
    // estimate from last event offset
    duration = allEvents[allEvents.length - 1].offset_seconds + 1;
  }
  var segmentCount = Math.max(1, Math.ceil(duration / SEGMENT_DURATION_S));
  var segments = [];
  for (var s = 0; s < segmentCount; s++) {
    var segStart = s * SEGMENT_DURATION_S;
    var segEnd = Math.min((s + 1) * SEGMENT_DURATION_S, duration);
    var segClicks = 0;
    var segSpeech = 0;
    var textParts = [];
    var screenshotRefs = [];
    for (var i = 0; i < allEvents.length; i++) {
      var ev = allEvents[i];
      if (ev.offset_seconds >= segStart && ev.offset_seconds < segEnd) {
        if (ev.type === 'click') {
          segClicks++;
          if (ev.page_url) textParts.push(ev.page_url);
          if (ev.page_title) textParts.push(ev.page_title);
          if (ev.screenshot) screenshotRefs.push(ev.screenshot);
          if (ev.screenshot_url) screenshotRefs.push(ev.screenshot_url);
        } else if (ev.type === 'speech') {
          segSpeech++;
          if (ev.text) textParts.push(ev.text);
        }
      }
    }
    var segDuration = segEnd - segStart;
    segments.push({
      segment_index: s,
      start_seconds: segStart,
      end_seconds: segEnd,
      click_count: segClicks,
      speech_count: segSpeech,
      engagement_score: calcEngagementScore(segClicks, segSpeech, segDuration),
      topics: detectTopics(textParts.join(' ')),
      screenshot_refs: screenshotRefs.filter(function(v, idx, arr) { return arr.indexOf(v) === idx; }),
    });
  }
  return segments;
}

/**
 * Correlate audio transcript + click events into a unified chronological timeline.
 *
 * Inputs (plain objects parsed from JSON):
 *   metadata    — metadata.json  (needs session_id, started_at)
 *   clicks      — clicks.json    (needs events[])
 *   transcript  — transcript.json (needs entries[], duration_seconds)
 *   screenshots — optional array of { file, timestamp } for screenshot matching
 *
 * Output:
 * {
 *   session_id, generated_at, started_at, duration_seconds,
 *   event_count, click_count, speech_count, skipped_clicks, skipped_speech, topics,
 *   segments: [{ segment_index, start_seconds, end_seconds,
 *     click_count, speech_count, engagement_score, topics[], screenshot_refs[] }],
 *   timeline: [
 *     // click event:
 *     { offset_seconds, timestamp, type:"click", index, dom_path, element,
 *       coordinates, page_url, page_title, screenshot, screenshot_url,
 *       speech_at_moment: { speaker, text, timestamp_offset } | null }
 *
 *     // speech event:
 *     { offset_seconds, timestamp, timestamp_offset, type:"speech",
 *       speaker, text, screenshot,
 *       clicks_during: [{ index, timestamp, dom_path, page_title, screenshot }] }
 *   ]
 * }
 */
function correlate(metadata, clicks, transcript, screenshots) {
  try {
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('metadata is required and must be an object');
  }
  const sessionId = metadata.session_id;
  const startedAt = metadata.started_at; // ISO string (UTC)
  if (!startedAt) {
    throw new Error('metadata.started_at is required');
  }
  const startMs = new Date(startedAt).getTime();
  if (isNaN(startMs)) {
    throw new Error('metadata.started_at is not a valid date: ' + startedAt);
  }

  // Safely coerce events/entries to arrays (handles non-array truthy values like strings/objects)
  const rawClickEvents = (clicks && Array.isArray(clicks.events)) ? clicks.events : [];
  const rawTranscriptEntries = (transcript && Array.isArray(transcript.entries)) ? transcript.entries : [];

  if (clicks && clicks.events && !Array.isArray(clicks.events)) {
    console.error('[correlate] clicks.events is not an array (got ' + typeof clicks.events + '), treating as empty');
  }
  if (transcript && transcript.entries && !Array.isArray(transcript.entries)) {
    console.error('[correlate] transcript.entries is not an array (got ' + typeof transcript.entries + '), treating as empty');
  }

  const hasClicks = rawClickEvents.length > 0;
  const hasTranscript = rawTranscriptEntries.length > 0;

  if (!hasClicks && !hasTranscript) {
    const now = new Date().toISOString();
    console.error(`[${now}] correlate: no clicks or transcript data available`);
    return {
      session_id: sessionId,
      generated_at: now,
      started_at: startedAt,
      duration_seconds: (transcript && transcript.duration_seconds) || null,
      event_count: 0,
      click_count: 0,
      speech_count: 0,
      skipped_clicks: 0,
      skipped_speech: 0,
      topics: [],
      segments: [],
      timeline: [],
    };
  }

  // --- Build click event objects (skip entries with missing/invalid timestamps) ---
  var skippedClicks = 0;
  const clickEvents = rawClickEvents.reduce((acc, ev) => {
    const tsMs = ev.timestamp ? new Date(ev.timestamp).getTime() : NaN;
    if (isNaN(tsMs)) {
      skippedClicks++;
      console.error('[correlate] skipping click event with missing/invalid timestamp at index ' + ev.index);
      return acc;
    }
    acc.push({
      _tsMs: tsMs,
      offset_seconds: (tsMs - startMs) / 1000,
      timestamp: ev.timestamp,
      type: 'click',
      index: ev.index,
      dom_path: ev.dom_path || null,
      element: ev.element || null,
      coordinates: ev.coordinates || null,
      page_url: ev.page_url || null,
      page_title: ev.page_title || null,
      screenshot: ev.screenshot_file || null,
      speech_at_moment: null, // populated below
    });
    return acc;
  }, []);

  // Sort clicks by time (defensive — clicks.json should already be ordered)
  clickEvents.sort((a, b) => a._tsMs - b._tsMs);

  if (skippedClicks > 0 && clickEvents.length === 0 && rawClickEvents.length > 0) {
    console.error('[correlate] WARNING: all ' + rawClickEvents.length + ' click events had invalid timestamps — 0 clicks in output');
  }

  // --- Build speech event objects (skip entries with missing/invalid timestamps) ---
  var skippedSpeech = 0;
  const speechEvents = rawTranscriptEntries.reduce((acc, entry) => {
    const offsetSeconds = parseOffset(entry.timestamp);
    if (isNaN(offsetSeconds)) {
      skippedSpeech++;
      console.error('[correlate] skipping transcript entry with missing/invalid timestamp: ' + JSON.stringify(entry.text || '').slice(0, 80));
      return acc;
    }
    const absTimestamp = addSeconds(startedAt, offsetSeconds);
    const tsMs = new Date(absTimestamp).getTime();
    acc.push({
      _tsMs: tsMs,
      offset_seconds: offsetSeconds,
      timestamp: absTimestamp,
      timestamp_offset: entry.timestamp,
      type: 'speech',
      speaker: entry.speaker || null,
      text: entry.text || '',
      screenshot: null, // populated below
      clicks_during: [], // populated below
    });
    return acc;
  }, []);

  if (skippedSpeech > 0 && speechEvents.length === 0 && rawTranscriptEntries.length > 0) {
    console.error('[correlate] WARNING: all ' + rawTranscriptEntries.length + ' transcript entries had invalid timestamps — 0 speech in output');
  }

  // Sort speech by time (defensive)
  speechEvents.sort((a, b) => a._tsMs - b._tsMs);

  // --- Cross-reference clicks and speech (only when both exist) ---
  if (clickEvents.length > 0 && speechEvents.length > 0) {
    // Nearest preceding click-screenshot for each speech event
    let lastScreenshot = null;
    let ci = 0;
    for (const speechEv of speechEvents) {
      while (ci < clickEvents.length && clickEvents[ci]._tsMs <= speechEv._tsMs) {
        if (clickEvents[ci].screenshot) {
          lastScreenshot = clickEvents[ci].screenshot;
        }
        ci++;
      }
      speechEv.screenshot = lastScreenshot;
    }

    // For each click: find the speech segment active at that moment
    for (const clickEv of clickEvents) {
      let activeSpeech = null;
      for (const speechEv of speechEvents) {
        if (speechEv._tsMs <= clickEv._tsMs) {
          activeSpeech = speechEv;
        } else {
          break;
        }
      }
      if (activeSpeech) {
        clickEv.speech_at_moment = {
          speaker: activeSpeech.speaker,
          text: activeSpeech.text,
          timestamp_offset: activeSpeech.timestamp_offset,
        };
      }
    }

    // For each speech entry: collect clicks that occurred during it
    for (let i = 0; i < speechEvents.length; i++) {
      const speechEv = speechEvents[i];
      const windowEnd = i + 1 < speechEvents.length ? speechEvents[i + 1]._tsMs : Infinity;
      for (const clickEv of clickEvents) {
        if (clickEv._tsMs >= speechEv._tsMs && clickEv._tsMs < windowEnd) {
          speechEv.clicks_during.push({
            index: clickEv.index,
            timestamp: clickEv.timestamp,
            dom_path: clickEv.dom_path,
            page_title: clickEv.page_title,
            screenshot: clickEv.screenshot,
          });
        }
      }
    }
  }

  // --- Match screenshots to clicks by timestamp (within 2s window) ---
  matchScreenshots(clickEvents, screenshots);

  // --- Merge and sort everything chronologically ---
  const allEvents = [...speechEvents, ...clickEvents].sort((a, b) => a._tsMs - b._tsMs);

  // --- Build enriched segments (engagement_score, topics, screenshot_refs) ---
  const durationS = (transcript && transcript.duration_seconds) || null;
  const segments = buildSegments(allEvents, durationS);

  // --- Detect session-level topics from all URLs + transcript text ---
  const allText = allEvents.map(function(ev) {
    var parts = [];
    if (ev.page_url) parts.push(ev.page_url);
    if (ev.page_title) parts.push(ev.page_title);
    if (ev.text) parts.push(ev.text);
    return parts.join(' ');
  }).join(' ');
  const topics = detectTopics(allText);

  // Strip internal _tsMs bookkeeping field
  const timeline = allEvents.map((ev) => {
    const out = { ...ev };
    delete out._tsMs;
    return out;
  });

  return {
    session_id: sessionId,
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    duration_seconds: durationS,
    event_count: timeline.length,
    click_count: clickEvents.length,
    speech_count: speechEvents.length,
    skipped_clicks: skippedClicks,
    skipped_speech: skippedSpeech,
    topics,
    segments,
    timeline,
  };

  } catch (err) {
    const now = new Date().toISOString();
    console.error(`[${now}] correlate error: ${err.message}`);
    console.error(err.stack);
    return {
      session_id: (metadata && metadata.session_id) || 'unknown',
      generated_at: now,
      started_at: (metadata && metadata.started_at) || null,
      duration_seconds: (transcript && transcript.duration_seconds) || null,
      event_count: 0,
      click_count: 0,
      speech_count: 0,
      skipped_clicks: 0,
      skipped_speech: 0,
      topics: [],
      segments: [],
      timeline: [],
      error: err.message,
    };
  }
}

module.exports = { correlate, parseOffset, matchScreenshots, detectTopics, calcEngagementScore, buildSegments };

// --- Self-test when run directly: node correlator.js ---
if (require.main === module) {
  const startedAt = '2026-03-29T10:00:00.000Z';

  const metadata = { session_id: 'test-session-001', started_at: startedAt };

  const clicks = {
    events: [
      { index: 1, timestamp: '2026-03-29T10:00:05.000Z', dom_path: 'body>div>button', element: 'Start Demo', coordinates: { x: 100, y: 200 }, page_url: 'https://portal.xdr.trendmicro.com/app/endpoint-security', page_title: 'Vision One - Endpoint Security', screenshot_file: 'shot-001.png' },
      { index: 2, timestamp: '2026-03-29T10:00:12.000Z', dom_path: 'body>div>a', element: 'Learn More', coordinates: { x: 300, y: 400 }, page_url: 'https://portal.xdr.trendmicro.com/app/cloud-security', page_title: 'Cloud Security', screenshot_file: 'shot-002.png' },
    ],
  };

  const transcript = {
    duration_seconds: 20,
    entries: [
      { timestamp: '00:00:03.000', speaker: 'SE', text: 'Let me show you the XDR dashboard' },
      { timestamp: '00:00:08.000', speaker: 'Visitor', text: 'I am interested in zero trust and endpoint protection' },
      { timestamp: '00:00:15.000', speaker: 'SE', text: 'And here is the detection and response engine' },
    ],
  };

  const screenshots = [
    { file: 'screenshots/click-001.jpg', timestamp: '2026-03-29T10:00:05.500Z' },
    { file: 'screenshots/click-002.jpg', timestamp: '2026-03-29T10:00:11.000Z' },
    { file: 'screenshots/periodic-001.jpg', timestamp: '2026-03-29T10:00:18.000Z' },
  ];

  let failures = 0;

  function assert(condition, label) {
    if (!condition) {
      console.error('  FAIL: ' + label);
      failures++;
    } else {
      console.log('  PASS: ' + label);
    }
  }

  // Test 1: Full correlation (clicks + transcript + screenshots)
  console.log('Test 1: full correlation (clicks + transcript + screenshots)');
  const full = correlate(metadata, clicks, transcript, screenshots);
  assert(full.session_id === 'test-session-001', 'session_id');
  assert(full.click_count === 2, 'click_count = 2');
  assert(full.speech_count === 3, 'speech_count = 3');
  assert(full.event_count === 5, 'event_count = 5');
  assert(full.timeline.length === 5, 'timeline has 5 entries');
  assert(full.timeline[0].type === 'speech', 'first event is speech (offset 3s)');
  assert(full.timeline[1].type === 'click', 'second event is click (offset 5s)');
  assert(!full.error, 'no error field');

  // Test 1b: Screenshot matching
  console.log('Test 1b: screenshot matching');
  var clickEv1 = full.timeline.find(function(e) { return e.type === 'click' && e.index === 1; });
  var clickEv2 = full.timeline.find(function(e) { return e.type === 'click' && e.index === 2; });
  assert(clickEv1.screenshot_url === 'screenshots/click-001.jpg', 'click 1 matched to screenshot (0.5s delta)');
  assert(clickEv2.screenshot_url === 'screenshots/click-002.jpg', 'click 2 matched to screenshot (1s delta)');

  // Test 1c: Topics detection
  console.log('Test 1c: topic detection');
  assert(Array.isArray(full.topics), 'topics is array');
  assert(full.topics.indexOf('XDR') !== -1, 'detected XDR topic');
  assert(full.topics.indexOf('Endpoint') !== -1, 'detected Endpoint topic');
  assert(full.topics.indexOf('Cloud') !== -1, 'detected Cloud topic');
  assert(full.topics.indexOf('Zero Trust') !== -1, 'detected Zero Trust topic');
  assert(full.topics.indexOf('Detection') !== -1, 'detected Detection topic');
  assert(full.topics.indexOf('Response') !== -1, 'detected Response topic');

  // Test 1d: Segments with engagement scores
  console.log('Test 1d: engagement segments');
  assert(Array.isArray(full.segments), 'segments is array');
  assert(full.segments.length === 1, 'one 30s segment for 20s session');
  assert(full.segments[0].engagement_score > 0, 'engagement_score > 0');
  assert(full.segments[0].click_count === 2, 'segment has 2 clicks');
  assert(full.segments[0].speech_count === 3, 'segment has 3 speech events');
  assert(full.segments[0].topics.length > 0, 'segment has topics');
  assert(full.segments[0].screenshot_refs.length > 0, 'segment has screenshot_refs');

  // Test 2: Clicks only (no transcript)
  console.log('Test 2: partial timeline (clicks only)');
  const clicksOnly = correlate(metadata, clicks, { entries: [], duration_seconds: 0 });
  assert(clicksOnly.click_count === 2, 'click_count = 2');
  assert(clicksOnly.speech_count === 0, 'speech_count = 0');
  assert(clicksOnly.event_count === 2, 'event_count = 2');
  assert(Array.isArray(clicksOnly.topics), 'topics is array');
  assert(Array.isArray(clicksOnly.segments), 'segments is array');
  assert(!clicksOnly.error, 'no error field');

  // Test 3: Transcript only (no clicks)
  console.log('Test 3: partial timeline (transcript only)');
  const speechOnly = correlate(metadata, { events: [] }, transcript);
  assert(speechOnly.click_count === 0, 'click_count = 0');
  assert(speechOnly.speech_count === 3, 'speech_count = 3');
  assert(speechOnly.event_count === 3, 'event_count = 3');
  assert(speechOnly.topics.indexOf('XDR') !== -1, 'transcript-only: detected XDR from speech');
  assert(!speechOnly.error, 'no error field');

  // Test 4: Null clicks/transcript
  console.log('Test 4: null inputs (graceful empty)');
  const empty = correlate(metadata, null, null);
  assert(empty.event_count === 0, 'event_count = 0');
  assert(empty.timeline.length === 0, 'empty timeline');
  assert(empty.topics.length === 0, 'empty topics');
  assert(empty.segments.length === 0, 'empty segments');
  assert(!empty.error, 'no error field');

  // Test 5: Bad metadata triggers catch
  console.log('Test 5: error handling (bad metadata)');
  const bad = correlate(null, clicks, transcript);
  assert(bad.error, 'has error field');
  assert(bad.session_id === 'unknown', 'session_id = unknown');
  assert(bad.timeline.length === 0, 'empty timeline on error');
  assert(bad.topics.length === 0, 'empty topics on error');
  assert(bad.segments.length === 0, 'empty segments on error');

  // Test 6: detectTopics unit test
  console.log('Test 6: detectTopics unit test');
  var topics1 = detectTopics('Looking at XDR and endpoint security with zero trust');
  assert(topics1.indexOf('XDR') !== -1, 'detectTopics: XDR');
  assert(topics1.indexOf('Endpoint') !== -1, 'detectTopics: Endpoint');
  assert(topics1.indexOf('Zero Trust') !== -1, 'detectTopics: Zero Trust');
  assert(topics1.indexOf('Container') === -1, 'detectTopics: no false positive Container');

  // Test 7: calcEngagementScore unit test
  console.log('Test 7: calcEngagementScore unit test');
  assert(calcEngagementScore(0, 0, 30) === 0, 'zero activity = score 0');
  assert(calcEngagementScore(5, 5, 30) === 10, 'max activity = score 10');
  assert(calcEngagementScore(3, 2, 30) > 0, 'moderate activity > 0');

  // Test 8: Screenshot outside 2s window is not matched
  console.log('Test 8: screenshot outside 2s window not matched');
  var farScreenshots = [{ file: 'far.jpg', timestamp: '2026-03-29T10:00:10.000Z' }];
  var result = correlate(metadata, clicks, transcript, farScreenshots);
  var click1 = result.timeline.find(function(e) { return e.type === 'click' && e.index === 1; });
  assert(!click1.screenshot_url, 'no screenshot_url when >2s away');

  // Test 9: Click events with missing timestamps are skipped (not crash)
  console.log('Test 9: click events with missing/invalid timestamps');
  var badClicks = { events: [
    { index: 1, timestamp: '2026-03-29T10:00:05.000Z', dom_path: 'body>div', page_title: 'Good' },
    { index: 2 },  // missing timestamp entirely
    { index: 3, timestamp: '' },  // empty string timestamp
    { index: 4, timestamp: '2026-03-29T10:00:08.000Z', dom_path: 'body>a', page_title: 'Also Good' },
  ]};
  var r9 = correlate(metadata, badClicks, transcript);
  assert(!r9.error, 'no error field');
  assert(r9.click_count === 2, 'only 2 valid clicks kept');
  assert(r9.event_count === 5, '2 clicks + 3 speech = 5 events');

  // Test 10: Transcript entries with missing timestamps are skipped (not crash)
  console.log('Test 10: transcript entries with missing/invalid timestamps');
  var badTranscript = { duration_seconds: 10, entries: [
    { timestamp: '00:00:03.000', speaker: 'SE', text: 'Good entry' },
    { speaker: 'Visitor', text: 'Missing timestamp entirely' },  // no timestamp
    { timestamp: '', speaker: 'SE', text: 'Empty timestamp' },  // empty string
    { timestamp: '00:00:07.000', speaker: 'Visitor', text: 'Another good entry' },
  ]};
  var r10 = correlate(metadata, clicks, badTranscript);
  assert(!r10.error, 'no error field');
  assert(r10.speech_count === 2, 'only 2 valid speech entries kept');
  assert(r10.click_count === 2, 'clicks unaffected');

  // Test 11: Both clicks and transcript have some bad entries
  console.log('Test 11: mixed valid/invalid entries in both inputs');
  var r11 = correlate(metadata, badClicks, badTranscript);
  assert(!r11.error, 'no error field');
  assert(r11.click_count === 2, '2 valid clicks');
  assert(r11.speech_count === 2, '2 valid speech');
  assert(r11.event_count === 4, '4 total events');
  assert(r11.segments.length > 0, 'segments still generated');

  // Test 12: clicks object without events property (object but no .events)
  console.log('Test 12: clicks object without events array');
  var r12 = correlate(metadata, { noEventsHere: true }, transcript);
  assert(!r12.error, 'no error field');
  assert(r12.click_count === 0, '0 clicks from missing events array');
  assert(r12.speech_count === 3, 'speech still processed');

  // Test 13: transcript object without entries property
  console.log('Test 13: transcript object without entries array');
  var r13 = correlate(metadata, clicks, { duration_seconds: 10 });
  assert(!r13.error, 'no error field');
  assert(r13.click_count === 2, 'clicks still processed');
  assert(r13.speech_count === 0, '0 speech from missing entries array');

  // Test 14: metadata missing started_at
  console.log('Test 14: metadata missing started_at');
  var r14 = correlate({ session_id: 'no-start' }, clicks, transcript);
  assert(r14.error, 'has error field');
  assert(r14.session_id === 'no-start', 'session_id preserved from metadata');
  assert(r14.timeline.length === 0, 'empty timeline on error');

  // Test 15: metadata with invalid started_at date
  console.log('Test 15: metadata with invalid started_at');
  var r15 = correlate({ session_id: 'bad-date', started_at: 'not-a-date' }, clicks, transcript);
  assert(r15.error, 'has error field');
  assert(r15.session_id === 'bad-date', 'session_id preserved');

  // Test 16: clicks.events is a non-array truthy value (string)
  console.log('Test 16: clicks.events is a string (non-array truthy)');
  var r16 = correlate(metadata, { events: 'not-an-array' }, transcript);
  assert(!r16.error, 'no error field');
  assert(r16.click_count === 0, '0 clicks from string events');
  assert(r16.speech_count === 3, 'speech still processed');

  // Test 17: transcript.entries is a non-array truthy value (object)
  console.log('Test 17: transcript.entries is an object (non-array truthy)');
  var r17 = correlate(metadata, clicks, { entries: { bad: true }, duration_seconds: 10 });
  assert(!r17.error, 'no error field');
  assert(r17.click_count === 2, 'clicks still processed');
  assert(r17.speech_count === 0, '0 speech from object entries');

  // Test 18: skipped_clicks and skipped_speech counters
  console.log('Test 18: skipped_clicks and skipped_speech counters');
  var r18 = correlate(metadata, badClicks, badTranscript);
  assert(r18.skipped_clicks === 2, 'skipped_clicks = 2 (indices 2 and 3)');
  assert(r18.skipped_speech === 2, 'skipped_speech = 2 (missing + empty timestamp)');

  // Test 19: skipped counters are 0 when all data is valid
  console.log('Test 19: skipped counters are 0 for valid data');
  var r19 = correlate(metadata, clicks, transcript);
  assert(r19.skipped_clicks === 0, 'skipped_clicks = 0');
  assert(r19.skipped_speech === 0, 'skipped_speech = 0');

  // Test 20: empty result includes skipped counters
  console.log('Test 20: empty result includes skipped counters');
  var r20 = correlate(metadata, null, null);
  assert(r20.skipped_clicks === 0, 'skipped_clicks = 0 on empty');
  assert(r20.skipped_speech === 0, 'skipped_speech = 0 on empty');

  // Test 21: clicks.events is a number (non-array truthy)
  console.log('Test 21: clicks.events is a number');
  var r21 = correlate(metadata, { events: 42 }, transcript);
  assert(!r21.error, 'no error field');
  assert(r21.click_count === 0, '0 clicks from numeric events');

  console.log('');
  if (failures === 0) {
    console.log('All tests passed.');
  } else {
    console.log(failures + ' test(s) failed.');
    process.exit(1);
  }
}
