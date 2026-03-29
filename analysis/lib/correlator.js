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
  const sessionId = metadata.session_id;
  const startedAt = metadata.started_at; // ISO string (UTC)
  const startMs = new Date(startedAt).getTime();

  // --- Build click event objects ---
  const clickEvents = (clicks.events || []).map((ev) => {
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
  const speechEvents = (transcript.entries || []).map((entry) => {
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

  // --- Nearest preceding click-screenshot for each speech event ---
  // Walk both arrays in timestamp order, carrying the last seen screenshot forward.
  let lastScreenshot = null;
  let ci = 0; // click index
  for (const speechEv of speechEvents) {
    // Advance past all clicks that happened before (or at) this speech entry
    while (ci < clickEvents.length && clickEvents[ci]._tsMs <= speechEv._tsMs) {
      if (clickEvents[ci].screenshot) {
        lastScreenshot = clickEvents[ci].screenshot;
      }
      ci++;
    }
    speechEv.screenshot = lastScreenshot;
  }

  // --- For each click: find the speech segment active at that moment ---
  // "Active" = the latest speech entry whose timestamp <= click timestamp
  for (const clickEv of clickEvents) {
    let activeSpeech = null;
    for (const speechEv of speechEvents) {
      if (speechEv._tsMs <= clickEv._tsMs) {
        activeSpeech = speechEv;
      } else {
        break; // speech is sorted, no need to look further
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

  // --- For each speech entry: collect clicks that occurred during it ---
  // "During" = from this entry's timestamp up to (but not including) the next entry
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
    duration_seconds: transcript.duration_seconds || null,
    event_count: timeline.length,
    click_count: clickEvents.length,
    speech_count: speechEvents.length,
    timeline,
  };
}

module.exports = { correlate, parseOffset };
