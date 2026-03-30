'use strict';

// Timestamp correlator: merges clicks.json + transcript.json into a unified timeline.
// Pure function — no S3 or file I/O.  pipeline-run.js handles data fetching.

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
 * Correlate audio transcript + click events into a unified chronological timeline.
 *
 * Inputs (plain objects parsed from JSON):
 *   metadata   — metadata.json  (needs session_id, started_at)
 *   clicks     — clicks.json    (needs events[])
 *   transcript — transcript.json (needs entries[], duration_seconds)
 *
 * Output:
 * {
 *   session_id, generated_at, started_at, duration_seconds,
 *   event_count, click_count, speech_count,
 *   timeline: [
 *     // click event:
 *     { offset_seconds, timestamp, type:"click", index, dom_path, element,
 *       coordinates, page_url, page_title, screenshot,
 *       speech_at_moment: { speaker, text, timestamp_offset } | null }
 *
 *     // speech event:
 *     { offset_seconds, timestamp, timestamp_offset, type:"speech",
 *       speaker, text, screenshot,
 *       clicks_during: [{ index, timestamp, dom_path, page_title, screenshot }] }
 *   ]
 * }
 */
function correlate(metadata, clicks, transcript) {
  try {
  const sessionId = metadata.session_id;
  const startedAt = metadata.started_at; // ISO string (UTC)
  const startMs = new Date(startedAt).getTime();

  const hasClicks = clicks && Array.isArray(clicks.events) && clicks.events.length > 0;
  const hasTranscript = transcript && Array.isArray(transcript.entries) && transcript.entries.length > 0;

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
      timeline: [],
    };
  }

  // --- Build click event objects ---
  const clickEvents = ((clicks && clicks.events) || []).map((ev) => {
    const tsMs = new Date(ev.timestamp).getTime();
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
      speech_at_moment: null, // populated below
    };
  });

  // Sort clicks by time (defensive — clicks.json should already be ordered)
  clickEvents.sort((a, b) => a._tsMs - b._tsMs);

  // --- Build speech event objects ---
  const speechEvents = ((transcript && transcript.entries) || []).map((entry) => {
    const offsetSeconds = parseOffset(entry.timestamp);
    const absTimestamp = addSeconds(startedAt, offsetSeconds);
    const tsMs = new Date(absTimestamp).getTime();
    return {
      _tsMs: tsMs,
      offset_seconds: offsetSeconds,
      timestamp: absTimestamp,
      timestamp_offset: entry.timestamp,
      type: 'speech',
      speaker: entry.speaker || null,
      text: entry.text || '',
      screenshot: null, // populated below
      clicks_during: [], // populated below
    };
  });

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

  // --- Merge and sort everything chronologically ---
  const allEvents = [...speechEvents, ...clickEvents].sort((a, b) => a._tsMs - b._tsMs);

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
    duration_seconds: (transcript && transcript.duration_seconds) || null,
    event_count: timeline.length,
    click_count: clickEvents.length,
    speech_count: speechEvents.length,
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
      timeline: [],
      error: err.message,
    };
  }
}

module.exports = { correlate, parseOffset };

// --- Self-test when run directly: node correlator.js ---
if (require.main === module) {
  const startedAt = '2026-03-29T10:00:00.000Z';

  const metadata = { session_id: 'test-session-001', started_at: startedAt };

  const clicks = {
    events: [
      { index: 1, timestamp: '2026-03-29T10:00:05.000Z', dom_path: 'body>div>button', element: 'Start Demo', coordinates: { x: 100, y: 200 }, page_url: 'https://example.com', page_title: 'Demo Page', screenshot_file: 'shot-001.png' },
      { index: 2, timestamp: '2026-03-29T10:00:12.000Z', dom_path: 'body>div>a', element: 'Learn More', coordinates: { x: 300, y: 400 }, page_url: 'https://example.com/learn', page_title: 'Learn Page', screenshot_file: 'shot-002.png' },
    ],
  };

  const transcript = {
    duration_seconds: 20,
    entries: [
      { timestamp: '00:00:03.000', speaker: 'SE', text: 'Let me show you the dashboard' },
      { timestamp: '00:00:08.000', speaker: 'Visitor', text: 'That looks interesting' },
      { timestamp: '00:00:15.000', speaker: 'SE', text: 'And here is the detection engine' },
    ],
  };

  let failures = 0;

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
  const full = correlate(metadata, clicks, transcript);
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
  const clicksOnly = correlate(metadata, clicks, { entries: [], duration_seconds: 0 });
  assert(clicksOnly.click_count === 2, 'click_count = 2');
  assert(clicksOnly.speech_count === 0, 'speech_count = 0');
  assert(clicksOnly.event_count === 2, 'event_count = 2');
  assert(!clicksOnly.error, 'no error field');

  // Test 3: Transcript only (no clicks)
  console.log('Test 3: partial timeline (transcript only)');
  const speechOnly = correlate(metadata, { events: [] }, transcript);
  assert(speechOnly.click_count === 0, 'click_count = 0');
  assert(speechOnly.speech_count === 3, 'speech_count = 3');
  assert(speechOnly.event_count === 3, 'event_count = 3');
  assert(!speechOnly.error, 'no error field');

  // Test 4: Null clicks/transcript
  console.log('Test 4: null inputs (graceful empty)');
  const empty = correlate(metadata, null, null);
  assert(empty.event_count === 0, 'event_count = 0');
  assert(empty.timeline.length === 0, 'empty timeline');
  assert(!empty.error, 'no error field');

  // Test 5: Bad metadata triggers catch
  console.log('Test 5: error handling (bad metadata)');
  const bad = correlate(null, clicks, transcript);
  assert(bad.error, 'has error field');
  assert(bad.session_id === 'unknown', 'session_id = unknown');
  assert(bad.timeline.length === 0, 'empty timeline on error');

  console.log('');
  if (failures === 0) {
    console.log('All tests passed.');
  } else {
    console.log(failures + ' test(s) failed.');
    process.exit(1);
  }
}
