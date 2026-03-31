'use strict';

// Timestamp correlator: merges clicks.json + transcript.json into a unified timeline.
// Pure function — no S3 or file I/O.  pipeline-run.js handles data fetching.

// --- Product topic detection dictionary ---
// Maps keywords (found in URLs, page titles, DOM paths, speech text) to product topics.
const PRODUCT_TOPICS = [
  { topic: 'Endpoint Security', keywords: ['endpoint', 'epp', 'endpoint-security', 'endpoint security', 'endpoint protection', 'anti-malware', 'antivirus'] },
  { topic: 'XDR', keywords: ['xdr', 'detection', 'workbench', 'observed attack techniques', 'oat', 'threat intelligence'] },
  { topic: 'Server & Workload Protection', keywords: ['workload', 'server protection', 'swp', 'deep security', 'virtual patching'] },
  { topic: 'Risk Insights', keywords: ['risk', 'risk insight', 'attack surface', 'exposure', 'vulnerability', 'cve'] },
  { topic: 'Zero Trust', keywords: ['zero trust', 'ztsa', 'secure access', 'private access'] },
  { topic: 'Email Security', keywords: ['email', 'email security', 'phishing', 'mail security'] },
  { topic: 'Cloud Security', keywords: ['cloud security', 'cloud posture', 'container', 'cloud one', 'conformity'] },
  { topic: 'Network Security', keywords: ['network security', 'network defense', 'tippingpoint', 'ips', 'intrusion'] },
  { topic: 'Identity Security', keywords: ['identity', 'identity security', 'ad security', 'active directory'] },
  { topic: 'Vision One Dashboard', keywords: ['dashboard', 'executive dashboard', 'risk index'] },
  { topic: 'Response Actions', keywords: ['response', 'isolate', 'quarantine', 'response action', 'containment'] },
  { topic: 'Search & Investigation', keywords: ['search', 'investigation', 'threat hunting', 'log search', 'advanced search'] },
];

// Parse transcript offset "HH:MM:SS.mmm" -> total seconds
function parseOffset(ts) {
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

/**
 * Match screenshot filenames to timeline events by timestamp proximity.
 *
 * screenshots — array of { filename, timestamp } objects.
 *   filename: e.g. "click-001.jpg" or "periodic-005.jpg"
 *   timestamp: ISO string of when the screenshot was taken
 *
 * Returns a sorted array of { filename, timestamp, _tsMs } for binary search.
 */
function buildScreenshotIndex(screenshots, startMs) {
  if (!Array.isArray(screenshots) || screenshots.length === 0) return [];
  return screenshots
    .map(function (s) {
      return {
        filename: s.filename,
        timestamp: s.timestamp,
        _tsMs: new Date(s.timestamp).getTime(),
        offset_seconds: (new Date(s.timestamp).getTime() - startMs) / 1000,
      };
    })
    .sort(function (a, b) { return a._tsMs - b._tsMs; });
}

/**
 * Find the nearest screenshot to a given timestamp (ms).
 * Uses binary search for efficiency. Returns the screenshot within maxGapMs (default 5s),
 * or null if none is close enough.
 */
function findNearestScreenshot(index, tsMs, maxGapMs) {
  if (index.length === 0) return null;
  if (typeof maxGapMs === 'undefined') maxGapMs = 5000;

  var lo = 0;
  var hi = index.length - 1;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (index[mid]._tsMs < tsMs) lo = mid + 1;
    else hi = mid;
  }

  // Check lo and lo-1 for closest
  var best = null;
  var bestDist = Infinity;
  var candidates = [lo - 1, lo, lo + 1];
  for (var i = 0; i < candidates.length; i++) {
    var ci = candidates[i];
    if (ci >= 0 && ci < index.length) {
      var dist = Math.abs(index[ci]._tsMs - tsMs);
      if (dist < bestDist) {
        bestDist = dist;
        best = index[ci];
      }
    }
  }

  if (best && bestDist <= maxGapMs) {
    return { filename: best.filename, timestamp: best.timestamp, offset_seconds: best.offset_seconds };
  }
  return null;
}

/**
 * Detect product topics mentioned across all timeline events.
 *
 * Scans page_url, page_title, dom_path, element text, and speech text.
 * Returns array of { topic, mentions, first_seen_offset, evidence[] }.
 */
function detectTopics(clickEvents, speechEvents) {
  var topicMap = {}; // topic -> { mentions, first_seen_offset, evidence Set }

  function check(text, offsetSeconds, source) {
    if (!text) return;
    var lower = text.toLowerCase();
    for (var t = 0; t < PRODUCT_TOPICS.length; t++) {
      var entry = PRODUCT_TOPICS[t];
      for (var k = 0; k < entry.keywords.length; k++) {
        if (lower.indexOf(entry.keywords[k]) >= 0) {
          if (!topicMap[entry.topic]) {
            topicMap[entry.topic] = { mentions: 0, first_seen_offset: offsetSeconds, evidenceSet: {} };
          }
          var rec = topicMap[entry.topic];
          rec.mentions++;
          if (offsetSeconds < rec.first_seen_offset) rec.first_seen_offset = offsetSeconds;
          rec.evidenceSet[source] = true;
          break; // one keyword match per topic per text is enough
        }
      }
    }
  }

  for (var i = 0; i < clickEvents.length; i++) {
    var ev = clickEvents[i];
    check(ev.page_url, ev.offset_seconds, 'click:page_url');
    check(ev.page_title, ev.offset_seconds, 'click:page_title');
    check(ev.dom_path, ev.offset_seconds, 'click:dom_path');
    var elemText = typeof ev.element === 'string' ? ev.element : (ev.element && ev.element.text) || null;
    check(elemText, ev.offset_seconds, 'click:element');
  }

  for (var j = 0; j < speechEvents.length; j++) {
    var se = speechEvents[j];
    check(se.text, se.offset_seconds, 'speech:' + (se.speaker || 'unknown'));
  }

  var results = [];
  var topics = Object.keys(topicMap);
  for (var ti = 0; ti < topics.length; ti++) {
    var name = topics[ti];
    var data = topicMap[name];
    results.push({
      topic: name,
      mentions: data.mentions,
      first_seen_offset: data.first_seen_offset,
      evidence: Object.keys(data.evidenceSet),
    });
  }
  // Sort by mentions descending, then by first appearance
  results.sort(function (a, b) {
    return b.mentions - a.mentions || a.first_seen_offset - b.first_seen_offset;
  });
  return results;
}

/**
 * Compute engagement score 0-10 from session signals.
 *
 * Signals weighted:
 *   - Click frequency (clicks per minute)           max 2.5 pts
 *   - Visitor speech ratio (visitor vs total speech) max 2.5 pts
 *   - Question count (visitor questions)             max 2.0 pts
 *   - Session duration (longer = more engaged)       max 1.5 pts
 *   - Topic diversity (distinct products explored)   max 1.5 pts
 */
function computeEngagement(clickEvents, speechEvents, durationSeconds, topicCount) {
  var score = 0;

  // Click frequency: clicks per minute, capped contribution at 10+ cpm
  var dur = durationSeconds || 0;
  if (dur > 0 && clickEvents.length > 0) {
    var cpm = (clickEvents.length / dur) * 60;
    score += Math.min(cpm / 4, 1) * 2.5; // 4 cpm = full score
  }

  // Visitor speech ratio
  var visitorWords = 0;
  var totalWords = 0;
  var questionCount = 0;
  for (var i = 0; i < speechEvents.length; i++) {
    var words = (speechEvents[i].text || '').split(/\s+/).filter(Boolean).length;
    totalWords += words;
    var isVisitor = speechEvents[i].speaker && speechEvents[i].speaker !== 'SE';
    if (isVisitor) {
      visitorWords += words;
      if ((speechEvents[i].text || '').indexOf('?') >= 0) questionCount++;
    }
  }
  if (totalWords > 0) {
    score += Math.min(visitorWords / totalWords, 1) * 2.5;
  }

  // Questions asked by visitor
  score += Math.min(questionCount / 3, 1) * 2.0; // 3+ questions = full score

  // Session duration: 5+ minutes = full score
  if (dur > 0) {
    score += Math.min(dur / 300, 1) * 1.5;
  }

  // Topic diversity: 3+ distinct topics = full score
  score += Math.min((topicCount || 0) / 3, 1) * 1.5;

  return Math.round(score * 10) / 10; // one decimal place, 0-10
}

/**
 * Correlate audio transcript + click events into a unified chronological timeline.
 *
 * Inputs (plain objects parsed from JSON):
 *   metadata   — metadata.json  (needs session_id, started_at)
 *   clicks     — clicks.json    (needs events[])
 *   transcript — transcript.json (needs entries[], duration_seconds)
 *   screenshots (optional) — array of { filename, timestamp } for periodic + click screenshots
 *
 * Output:
 * {
 *   session_id, generated_at, started_at, duration_seconds,
 *   event_count, click_count, speech_count,
 *   engagement_score,    // 0-10 engagement rating
 *   topics_detected,     // [{ topic, mentions, first_seen_offset, evidence[] }]
 *   timeline: [
 *     // click event:
 *     { offset_seconds, timestamp, type:"click", index, dom_path, element,
 *       coordinates, page_url, page_title, screenshot, matched_screenshots,
 *       speech_at_moment: { speaker, text, timestamp_offset } | null }
 *
 *     // speech event:
 *     { offset_seconds, timestamp, timestamp_offset, type:"speech",
 *       speaker, text, screenshot, matched_screenshots,
 *       clicks_during: [{ index, timestamp, dom_path, page_title, screenshot }] }
 *   ]
 * }
 */
function correlate(metadata, clicks, transcript, screenshots) {
  try {
  var sessionId = metadata.session_id;
  var startedAt = metadata.started_at; // ISO string (UTC)
  var startMs = new Date(startedAt).getTime();

  var hasClicks = clicks && Array.isArray(clicks.events) && clicks.events.length > 0;
  var hasTranscript = transcript && Array.isArray(transcript.entries) && transcript.entries.length > 0;

  if (!hasClicks && !hasTranscript) {
    var now = new Date().toISOString();
    console.error('[' + now + '] correlate: no clicks or transcript data available');
    return {
      session_id: sessionId,
      generated_at: now,
      started_at: startedAt,
      duration_seconds: (transcript && transcript.duration_seconds) || null,
      event_count: 0,
      click_count: 0,
      speech_count: 0,
      engagement_score: 0,
      topics_detected: [],
      timeline: [],
    };
  }

  // --- Build screenshot index for timestamp matching ---
  var ssIndex = buildScreenshotIndex(screenshots, startMs);

  // --- Build click event objects ---
  var clickEvents = ((clicks && clicks.events) || []).map(function (ev) {
    var tsMs = new Date(ev.timestamp).getTime();
    return {
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
      matched_screenshots: [],
      speech_at_moment: null, // populated below
    };
  });

  // Sort clicks by time (defensive — clicks.json should already be ordered)
  clickEvents.sort(function (a, b) { return a._tsMs - b._tsMs; });

  // --- Build speech event objects ---
  var speechEvents = ((transcript && transcript.entries) || []).map(function (entry) {
    var offsetSeconds = parseOffset(entry.timestamp);
    var absTimestamp = addSeconds(startedAt, offsetSeconds);
    var tsMs = new Date(absTimestamp).getTime();
    return {
      _tsMs: tsMs,
      offset_seconds: offsetSeconds,
      timestamp: absTimestamp,
      timestamp_offset: entry.timestamp,
      type: 'speech',
      speaker: entry.speaker || null,
      text: entry.text || '',
      screenshot: null, // populated below
      matched_screenshots: [],
      clicks_during: [], // populated below
    };
  });

  // Sort speech by time (defensive)
  speechEvents.sort(function (a, b) { return a._tsMs - b._tsMs; });

  // --- Match screenshots to events by timestamp proximity ---
  if (ssIndex.length > 0) {
    for (var si = 0; si < clickEvents.length; si++) {
      var matchedClick = findNearestScreenshot(ssIndex, clickEvents[si]._tsMs);
      if (matchedClick) clickEvents[si].matched_screenshots.push(matchedClick);
    }
    for (var sj = 0; sj < speechEvents.length; sj++) {
      var matchedSpeech = findNearestScreenshot(ssIndex, speechEvents[sj]._tsMs);
      if (matchedSpeech) speechEvents[sj].matched_screenshots.push(matchedSpeech);
    }
  }

  // --- Cross-reference clicks and speech (only when both exist) ---
  if (clickEvents.length > 0 && speechEvents.length > 0) {
    // Nearest preceding click-screenshot for each speech event
    var lastScreenshot = null;
    var ci = 0;
    for (var k = 0; k < speechEvents.length; k++) {
      var speechEv = speechEvents[k];
      while (ci < clickEvents.length && clickEvents[ci]._tsMs <= speechEv._tsMs) {
        if (clickEvents[ci].screenshot) {
          lastScreenshot = clickEvents[ci].screenshot;
        }
        ci++;
      }
      speechEv.screenshot = lastScreenshot;
    }

    // For each click: find the speech segment active at that moment
    for (var m = 0; m < clickEvents.length; m++) {
      var clickEv = clickEvents[m];
      var activeSpeech = null;
      for (var n = 0; n < speechEvents.length; n++) {
        if (speechEvents[n]._tsMs <= clickEv._tsMs) {
          activeSpeech = speechEvents[n];
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
    for (var p = 0; p < speechEvents.length; p++) {
      var spEv = speechEvents[p];
      var windowEnd = p + 1 < speechEvents.length ? speechEvents[p + 1]._tsMs : Infinity;
      for (var q = 0; q < clickEvents.length; q++) {
        if (clickEvents[q]._tsMs >= spEv._tsMs && clickEvents[q]._tsMs < windowEnd) {
          spEv.clicks_during.push({
            index: clickEvents[q].index,
            timestamp: clickEvents[q].timestamp,
            dom_path: clickEvents[q].dom_path,
            page_title: clickEvents[q].page_title,
            screenshot: clickEvents[q].screenshot,
          });
        }
      }
    }
  }

  // --- Detect product topics ---
  var topicsDetected = detectTopics(clickEvents, speechEvents);

  // --- Compute engagement score ---
  var durationSeconds = (transcript && transcript.duration_seconds) || null;
  var engagementScore = computeEngagement(clickEvents, speechEvents, durationSeconds, topicsDetected.length);

  // --- Merge and sort everything chronologically ---
  var allEvents = speechEvents.concat(clickEvents).sort(function (a, b) { return a._tsMs - b._tsMs; });

  // Strip internal _tsMs bookkeeping field
  var timeline = allEvents.map(function (ev) {
    var out = {};
    var keys = Object.keys(ev);
    for (var ki = 0; ki < keys.length; ki++) {
      if (keys[ki] !== '_tsMs') out[keys[ki]] = ev[keys[ki]];
    }
    return out;
  });

  return {
    session_id: sessionId,
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    duration_seconds: durationSeconds,
    event_count: timeline.length,
    click_count: clickEvents.length,
    speech_count: speechEvents.length,
    engagement_score: engagementScore,
    topics_detected: topicsDetected,
    timeline: timeline,
  };

  } catch (err) {
    var errNow = new Date().toISOString();
    console.error('[' + errNow + '] correlate error: ' + err.message);
    console.error(err.stack);
    return {
      session_id: (metadata && metadata.session_id) || 'unknown',
      generated_at: errNow,
      started_at: (metadata && metadata.started_at) || null,
      duration_seconds: (transcript && transcript.duration_seconds) || null,
      event_count: 0,
      click_count: 0,
      speech_count: 0,
      engagement_score: 0,
      topics_detected: [],
      timeline: [],
      error: err.message,
    };
  }
}

module.exports = { correlate, parseOffset, detectTopics, computeEngagement, findNearestScreenshot, buildScreenshotIndex };

// --- Self-test when run directly: node correlator.js ---
if (require.main === module) {
  var startedAt = '2026-03-29T10:00:00.000Z';

  var metadata = { session_id: 'test-session-001', started_at: startedAt };

  var clicks = {
    events: [
      { index: 1, timestamp: '2026-03-29T10:00:05.000Z', dom_path: 'body>div>button.endpoint-security', element: 'Endpoint Security', coordinates: { x: 100, y: 200 }, page_url: 'https://portal.xdr.trendmicro.com/app/endpoint-security', page_title: 'Vision One - Endpoint Security', screenshot_file: 'shot-001.png' },
      { index: 2, timestamp: '2026-03-29T10:00:12.000Z', dom_path: 'body>div>a.xdr-workbench', element: 'XDR Workbench', coordinates: { x: 300, y: 400 }, page_url: 'https://portal.xdr.trendmicro.com/app/xdr', page_title: 'Vision One - XDR Workbench', screenshot_file: 'shot-002.png' },
    ],
  };

  var transcript = {
    duration_seconds: 20,
    entries: [
      { timestamp: '00:00:03.000', speaker: 'SE', text: 'Let me show you the dashboard and risk insights' },
      { timestamp: '00:00:08.000', speaker: 'Visitor', text: 'How does the endpoint detection work?' },
      { timestamp: '00:00:15.000', speaker: 'SE', text: 'And here is the XDR workbench for threat hunting' },
    ],
  };

  var screenshots = [
    { filename: 'periodic-001.jpg', timestamp: '2026-03-29T10:00:02.000Z' },
    { filename: 'click-001.jpg', timestamp: '2026-03-29T10:00:05.200Z' },
    { filename: 'periodic-002.jpg', timestamp: '2026-03-29T10:00:07.000Z' },
    { filename: 'click-002.jpg', timestamp: '2026-03-29T10:00:12.100Z' },
    { filename: 'periodic-003.jpg', timestamp: '2026-03-29T10:00:16.000Z' },
  ];

  var failures = 0;

  function assert(condition, label) {
    if (!condition) {
      console.error('  FAIL: ' + label);
      failures++;
    } else {
      console.log('  PASS: ' + label);
    }
  }

  // Test 1: Full correlation (clicks + transcript)
  console.log('Test 1: full correlation (clicks + transcript)');
  var full = correlate(metadata, clicks, transcript);
  assert(full.session_id === 'test-session-001', 'session_id');
  assert(full.click_count === 2, 'click_count = 2');
  assert(full.speech_count === 3, 'speech_count = 3');
  assert(full.event_count === 5, 'event_count = 5');
  assert(full.timeline.length === 5, 'timeline has 5 entries');
  assert(full.timeline[0].type === 'speech', 'first event is speech (offset 3s)');
  assert(full.timeline[1].type === 'click', 'second event is click (offset 5s)');
  assert(!full.error, 'no error field');

  // Test 2: Clicks only (no transcript)
  console.log('Test 2: partial timeline (clicks only)');
  var clicksOnly = correlate(metadata, clicks, { entries: [], duration_seconds: 0 });
  assert(clicksOnly.click_count === 2, 'click_count = 2');
  assert(clicksOnly.speech_count === 0, 'speech_count = 0');
  assert(clicksOnly.event_count === 2, 'event_count = 2');
  assert(!clicksOnly.error, 'no error field');

  // Test 3: Transcript only (no clicks)
  console.log('Test 3: partial timeline (transcript only)');
  var speechOnly = correlate(metadata, { events: [] }, transcript);
  assert(speechOnly.click_count === 0, 'click_count = 0');
  assert(speechOnly.speech_count === 3, 'speech_count = 3');
  assert(speechOnly.event_count === 3, 'event_count = 3');
  assert(!speechOnly.error, 'no error field');

  // Test 4: Null clicks/transcript
  console.log('Test 4: null inputs (graceful empty)');
  var empty = correlate(metadata, null, null);
  assert(empty.event_count === 0, 'event_count = 0');
  assert(empty.timeline.length === 0, 'empty timeline');
  assert(!empty.error, 'no error field');

  // Test 5: Bad metadata triggers catch
  console.log('Test 5: error handling (bad metadata)');
  var bad = correlate(null, clicks, transcript);
  assert(bad.error, 'has error field');
  assert(bad.session_id === 'unknown', 'session_id = unknown');
  assert(bad.timeline.length === 0, 'empty timeline on error');

  // Test 6: Screenshot matching
  console.log('Test 6: screenshot timestamp matching');
  var withSS = correlate(metadata, clicks, transcript, screenshots);
  assert(withSS.timeline.length === 5, 'timeline still has 5 entries');
  // Click at T+5s should match click-001.jpg (T+5.2s, within 5s window)
  var clickAt5 = withSS.timeline.filter(function (e) { return e.type === 'click' && e.index === 1; })[0];
  assert(clickAt5.matched_screenshots.length === 1, 'click at 5s has 1 matched screenshot');
  assert(clickAt5.matched_screenshots[0].filename === 'click-001.jpg', 'matched click-001.jpg');
  // Speech at T+3s should match periodic-001.jpg (T+2s, within 5s window)
  var speechAt3 = withSS.timeline.filter(function (e) { return e.type === 'speech' && e.offset_seconds === 3; })[0];
  assert(speechAt3.matched_screenshots.length === 1, 'speech at 3s has 1 matched screenshot');
  assert(speechAt3.matched_screenshots[0].filename === 'periodic-001.jpg', 'matched periodic-001.jpg');

  // Test 7: Engagement scoring
  console.log('Test 7: engagement scoring');
  assert(typeof full.engagement_score === 'number', 'engagement_score is a number');
  assert(full.engagement_score >= 0 && full.engagement_score <= 10, 'score in 0-10 range');
  assert(full.engagement_score > 0, 'score > 0 for active session');
  // Empty session should score 0
  assert(empty.engagement_score === 0, 'empty session scores 0');
  // Error session should score 0
  assert(bad.engagement_score === 0, 'error session scores 0');

  // Test 8: Product topic detection
  console.log('Test 8: product topic detection');
  assert(Array.isArray(full.topics_detected), 'topics_detected is array');
  assert(full.topics_detected.length > 0, 'detected at least 1 topic');
  var topicNames = full.topics_detected.map(function (t) { return t.topic; });
  assert(topicNames.indexOf('Endpoint Security') >= 0, 'detected Endpoint Security');
  assert(topicNames.indexOf('XDR') >= 0, 'detected XDR');
  // Each topic has required fields
  var firstTopic = full.topics_detected[0];
  assert(typeof firstTopic.mentions === 'number' && firstTopic.mentions > 0, 'topic has mentions count');
  assert(typeof firstTopic.first_seen_offset === 'number', 'topic has first_seen_offset');
  assert(Array.isArray(firstTopic.evidence) && firstTopic.evidence.length > 0, 'topic has evidence');
  // Empty session has no topics
  assert(empty.topics_detected.length === 0, 'empty session has no topics');

  // Test 9: No screenshots param (backward compatible)
  console.log('Test 9: backward compatibility (no screenshots param)');
  var noSS = correlate(metadata, clicks, transcript);
  assert(noSS.timeline.length === 5, 'works without screenshots param');
  var anyClick = noSS.timeline.filter(function (e) { return e.type === 'click'; })[0];
  assert(Array.isArray(anyClick.matched_screenshots), 'matched_screenshots field exists');
  assert(anyClick.matched_screenshots.length === 0, 'matched_screenshots empty when no ss data');

  // Test 10: findNearestScreenshot edge cases
  console.log('Test 10: screenshot matching edge cases');
  var ssIdx = buildScreenshotIndex(screenshots, new Date(startedAt).getTime());
  // Exact match
  var exact = findNearestScreenshot(ssIdx, new Date('2026-03-29T10:00:05.200Z').getTime());
  assert(exact && exact.filename === 'click-001.jpg', 'exact timestamp match');
  // Too far away (>5s from any screenshot)
  var tooFar = findNearestScreenshot(ssIdx, new Date('2026-03-29T10:00:30.000Z').getTime());
  assert(tooFar === null, 'null when no screenshot within 5s');
  // Empty index
  var emptyResult = findNearestScreenshot([], new Date(startedAt).getTime());
  assert(emptyResult === null, 'null for empty index');

  console.log('');
  if (failures === 0) {
    console.log('All tests passed.');
  } else {
    console.log(failures + ' test(s) failed.');
    process.exit(1);
  }
}
