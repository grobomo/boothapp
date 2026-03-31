"use strict";

/**
 * Correlator -- merges click events, transcript segments, and screenshots
 * into a unified, time-sorted timeline with a configurable correlation window.
 *
 * Each click event:   { timestamp: <ms>, url, element, x, y }
 * Each transcript:    { start: <ms>, end: <ms>, text }
 * Screenshots map:    { "click-001.jpg": <ms>, ... } (filename -> timestamp)
 *
 * Output timeline entries:
 *   { type: "click"|"speech", timestamp: <ms>, ...originalFields, screenshot? }
 */

const DEFAULT_WINDOW_MS = 2000;

/**
 * Find the screenshot filename whose timestamp falls within windowMs of the
 * given target timestamp. Returns the closest match or null.
 */
function matchScreenshot(targetMs, screenshots, windowMs) {
  if (!screenshots || typeof screenshots !== "object") return null;
  let best = null;
  let bestDelta = Infinity;
  for (const [filename, ts] of Object.entries(screenshots)) {
    const delta = Math.abs(ts - targetMs);
    if (delta <= windowMs && delta < bestDelta) {
      best = filename;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Correlate clicks, transcript segments, and screenshots into a sorted timeline.
 *
 * @param {Object} opts
 * @param {Array}  opts.clicks       - Click events with `timestamp` (ms)
 * @param {Array}  opts.transcript   - Transcript segments with `start`/`end` (ms)
 * @param {Object} opts.screenshots  - Map of filename -> timestamp (ms)
 * @param {number} [opts.windowMs]   - Correlation window (default 2000ms)
 * @returns {Array} Sorted timeline entries
 */
function correlate({ clicks = [], transcript = [], screenshots = {}, windowMs = DEFAULT_WINDOW_MS } = {}) {
  const timeline = [];

  for (const click of clicks) {
    const entry = {
      type: "click",
      timestamp: click.timestamp,
      url: click.url || null,
      element: click.element || null,
      x: click.x,
      y: click.y,
    };
    const shot = matchScreenshot(click.timestamp, screenshots, windowMs);
    if (shot) {
      entry.screenshot = shot;
    }
    timeline.push(entry);
  }

  for (const seg of transcript) {
    timeline.push({
      type: "speech",
      timestamp: seg.start,
      end: seg.end,
      text: seg.text,
    });
  }

  timeline.sort((a, b) => a.timestamp - b.timestamp);
  return timeline;
}

module.exports = { correlate, matchScreenshot, DEFAULT_WINDOW_MS };
