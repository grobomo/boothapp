'use strict';

const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Product context: URL pattern -> product name
// ---------------------------------------------------------------------------
const PRODUCT_PATTERNS = [
  { pattern: /\/app\/xdr|\/app\/workbench|menuxdr_app/i, product: 'Vision One XDR' },
  { pattern: /\/app\/epp\/endpoint-protection|endpoint.security|menuendpoint_security/i, product: 'Endpoint Security' },
  { pattern: /\/app\/epp\/workload-protection|server.*workload|menuserver_cloud_app/i, product: 'Server & Workload Protection' },
  { pattern: /zero.trust|\/app\/zero|menuzero_trust|ztsa/i, product: 'Zero Trust Secure Access' },
  { pattern: /cloud.security|container|kubernetes|\/app\/cloud/i, product: 'Cloud Security' },
  { pattern: /email.security|\/app\/email|menuemail_security/i, product: 'Email Security' },
  { pattern: /network.security|\/app\/network|menunetwork_security/i, product: 'Network Security' },
  { pattern: /risk.insights|risk.overview|cyber.risk/i, product: 'Cyber Risk Overview' },
  { pattern: /attack.surface|\/app\/attack-surface/i, product: 'Attack Surface Management' },
  { pattern: /identity.security|\/app\/identity/i, product: 'Identity Security' },
];

/**
 * Detect V1 product from a URL string.
 * @param {string} url
 * @returns {string|null} Product name or null
 */
function detectProduct(url) {
  if (!url) return null;
  for (const { pattern, product } of PRODUCT_PATTERNS) {
    if (pattern.test(url)) return product;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Screenshot matching
// ---------------------------------------------------------------------------

/**
 * Parse screenshot filenames to extract sequence numbers.
 * Expects files named click-NNN.jpg in the screenshots directory.
 * @param {string} screenshotsDir - Path to screenshots/ folder
 * @returns {Array<{file: string, index: number}>} Sorted by index
 */
function listScreenshots(screenshotsDir) {
  if (!screenshotsDir || !fs.existsSync(screenshotsDir)) return [];
  return fs.readdirSync(screenshotsDir)
    .filter((f) => /^click-\d+\.jpg$/i.test(f))
    .map((f) => ({
      file: f,
      index: parseInt(f.match(/click-(\d+)/)[1], 10),
    }))
    .sort((a, b) => a.index - b.index);
}

/**
 * Match a click (by its 1-based index in the clicks array) to the closest screenshot.
 * Screenshots are named click-NNN.jpg where NNN corresponds to click order.
 * @param {number} clickIndex - 1-based click index
 * @param {Array} screenshots - From listScreenshots()
 * @returns {string|null} Screenshot filename or null
 */
function matchScreenshot(clickIndex, screenshots) {
  if (!screenshots || screenshots.length === 0) return null;
  let closest = screenshots[0];
  let minDist = Math.abs(clickIndex - closest.index);
  for (const s of screenshots) {
    const dist = Math.abs(clickIndex - s.index);
    if (dist < minDist) {
      minDist = dist;
      closest = s;
    }
  }
  return closest.file;
}

// ---------------------------------------------------------------------------
// Speaker diarization alignment
// ---------------------------------------------------------------------------

/**
 * Find who was speaking at a given timestamp.
 * Transcript segments may have a `speaker` field from diarization.
 * @param {number} timestampMs - Epoch milliseconds
 * @param {Array} transcript - Array of {start_ms, end_ms, text, speaker?}
 * @returns {string|null} Speaker label or null
 */
function findSpeaker(timestampMs, transcript) {
  if (!transcript || transcript.length === 0) return null;
  for (const seg of transcript) {
    if (timestampMs >= seg.start_ms && timestampMs <= seg.end_ms && seg.speaker) {
      return seg.speaker;
    }
  }
  // Fallback: find the closest segment within 2 seconds
  let closest = null;
  let minDist = Infinity;
  for (const seg of transcript) {
    const mid = (seg.start_ms + seg.end_ms) / 2;
    const dist = Math.abs(timestampMs - mid);
    if (dist < minDist && dist <= 2000 && seg.speaker) {
      minDist = dist;
      closest = seg.speaker;
    }
  }
  return closest;
}

/**
 * Find the transcript text active at a given timestamp.
 * @param {number} timestampMs
 * @param {Array} transcript
 * @returns {string|null}
 */
function findTranscriptText(timestampMs, transcript) {
  if (!transcript || transcript.length === 0) return null;
  for (const seg of transcript) {
    if (timestampMs >= seg.start_ms && timestampMs <= seg.end_ms) {
      return seg.text;
    }
  }
  // Fallback: closest within 2-second window
  let closest = null;
  let minDist = Infinity;
  for (const seg of transcript) {
    const mid = (seg.start_ms + seg.end_ms) / 2;
    const dist = Math.abs(timestampMs - mid);
    if (dist < minDist && dist <= 2000) {
      minDist = dist;
      closest = seg.text;
    }
  }
  return closest;
}

// ---------------------------------------------------------------------------
// Interaction clustering
// ---------------------------------------------------------------------------

/**
 * Group rapid sequential clicks into interaction clusters.
 * Clicks within `gapMs` of each other form a single cluster.
 * @param {Array} clicks - Sorted by timestamp
 * @param {number} [gapMs=2000] - Maximum gap between clicks in a cluster
 * @returns {Array<{clicks: Array, startMs: number, endMs: number, durationMs: number}>}
 */
function clusterInteractions(clicks, gapMs) {
  if (typeof gapMs === 'undefined') gapMs = 2000;
  if (!clicks || clicks.length === 0) return [];

  var clusters = [];
  var current = { clicks: [clicks[0]], startMs: clicks[0].timestamp, endMs: clicks[0].timestamp };

  for (var i = 1; i < clicks.length; i++) {
    var gap = clicks[i].timestamp - current.endMs;
    if (gap <= gapMs) {
      current.clicks.push(clicks[i]);
      current.endMs = clicks[i].timestamp;
    } else {
      current.durationMs = current.endMs - current.startMs;
      clusters.push(current);
      current = { clicks: [clicks[i]], startMs: clicks[i].timestamp, endMs: clicks[i].timestamp };
    }
  }
  current.durationMs = current.endMs - current.startMs;
  clusters.push(current);
  return clusters;
}

// ---------------------------------------------------------------------------
// Main correlator
// ---------------------------------------------------------------------------

/**
 * Correlate clicks, transcript, and screenshots into an enhanced timeline.
 *
 * @param {object} opts
 * @param {Array} opts.clicks - Click events [{timestamp, url, element, x, y}]
 * @param {Array} [opts.transcript] - Transcript segments [{start_ms, end_ms, text, speaker?}]
 * @param {string} [opts.screenshotsDir] - Path to screenshots/ folder
 * @param {object} [opts.badge] - Visitor badge data {name, company, title, email}
 * @param {number} [opts.clusterGapMs=2000] - Gap threshold for interaction clustering
 * @returns {object} Enhanced timeline
 */
function correlate(opts) {
  var clicks = opts.clicks || [];
  var transcript = opts.transcript || [];
  var screenshotsDir = opts.screenshotsDir || null;
  var badge = opts.badge || null;
  var clusterGapMs = typeof opts.clusterGapMs !== 'undefined' ? opts.clusterGapMs : 2000;

  // Sort clicks by timestamp
  var sorted = clicks.slice().sort(function (a, b) { return a.timestamp - b.timestamp; });

  // Load screenshots
  var screenshots = listScreenshots(screenshotsDir);

  // Build enriched events
  var events = sorted.map(function (click, idx) {
    var clickIndex = idx + 1; // 1-based
    var event = {
      type: 'click',
      timestamp: click.timestamp,
      url: click.url || null,
      element: click.element || null,
      x: click.x,
      y: click.y,
      // New fields
      screenshot: matchScreenshot(clickIndex, screenshots),
      speaker: findSpeaker(click.timestamp, transcript),
      transcript_text: findTranscriptText(click.timestamp, transcript),
      product: detectProduct(click.url),
    };
    return event;
  });

  // Build interaction clusters
  var clusters = clusterInteractions(sorted, clusterGapMs);
  var interactions = clusters.map(function (cluster, idx) {
    // Determine dominant product in cluster
    var products = {};
    cluster.clicks.forEach(function (c) {
      var p = detectProduct(c.url);
      if (p) products[p] = (products[p] || 0) + 1;
    });
    var dominantProduct = null;
    var maxCount = 0;
    Object.keys(products).forEach(function (p) {
      if (products[p] > maxCount) {
        maxCount = products[p];
        dominantProduct = p;
      }
    });

    return {
      interaction_id: idx + 1,
      start_ms: cluster.startMs,
      end_ms: cluster.endMs,
      duration_ms: cluster.durationMs,
      click_count: cluster.clicks.length,
      product: dominantProduct,
      urls: cluster.clicks.map(function (c) { return c.url; }).filter(Boolean),
    };
  });

  // Collect unique products visited
  var productsVisited = {};
  events.forEach(function (e) {
    if (e.product) productsVisited[e.product] = true;
  });

  // Build speaker timeline (who spoke when, based on transcript)
  var speakerTimeline = [];
  if (transcript.length > 0) {
    var speakers = {};
    transcript.forEach(function (seg) {
      if (seg.speaker) {
        if (!speakers[seg.speaker]) speakers[seg.speaker] = { segments: 0, total_ms: 0 };
        speakers[seg.speaker].segments += 1;
        speakers[seg.speaker].total_ms += (seg.end_ms - seg.start_ms);
      }
    });
    Object.keys(speakers).forEach(function (s) {
      speakerTimeline.push({
        speaker: s,
        segments: speakers[s].segments,
        total_ms: speakers[s].total_ms,
      });
    });
  }

  var timeline = {
    version: 2,
    generated_at: new Date().toISOString(),
    badge: badge,
    summary: {
      total_clicks: events.length,
      total_interactions: interactions.length,
      products_visited: Object.keys(productsVisited),
      speakers: speakerTimeline,
      duration_ms: events.length > 0
        ? events[events.length - 1].timestamp - events[0].timestamp
        : 0,
    },
    events: events,
    interactions: interactions,
  };

  return timeline;
}

/**
 * Load session data from a directory and produce the enhanced timeline.
 * @param {string} sessionDir - Path to session directory
 * @returns {object} Enhanced timeline
 */
function correlateSession(sessionDir) {
  var clicksPath = path.join(sessionDir, 'clicks.json');
  var transcriptPath = path.join(sessionDir, 'transcript.json');
  var badgePath = path.join(sessionDir, 'badge.json');
  var screenshotsDir = path.join(sessionDir, 'screenshots');

  var clicks = [];
  if (fs.existsSync(clicksPath)) {
    clicks = JSON.parse(fs.readFileSync(clicksPath, 'utf-8'));
  }

  var transcript = [];
  if (fs.existsSync(transcriptPath)) {
    transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
  }

  var badge = null;
  if (fs.existsSync(badgePath)) {
    badge = JSON.parse(fs.readFileSync(badgePath, 'utf-8'));
  }

  return correlate({
    clicks: clicks,
    transcript: transcript,
    screenshotsDir: screenshotsDir,
    badge: badge,
  });
}

module.exports = {
  correlate,
  correlateSession,
  detectProduct,
  listScreenshots,
  matchScreenshot,
  findSpeaker,
  findTranscriptText,
  clusterInteractions,
};
