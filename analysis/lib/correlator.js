'use strict';

// ---------------------------------------------------------------------------
// Correlator — merges click events, transcript segments, and screenshots
// into an enriched timeline with engagement scores and topic detection.
// ---------------------------------------------------------------------------

const SCREENSHOT_MATCH_WINDOW_MS = 2000;

const PRODUCT_TOPICS = {
  'XDR':              [/\bxdr\b/i, /\bagentic.siem\b/i, /\bdetection.and.response\b/i],
  'Endpoint':         [/\bendpoint/i, /\bepp\b/i, /\bedr\b/i, /\bworkload.protection\b/i],
  'Email':            [/\bemail.security\b/i, /\bemail.protection\b/i, /\bcecp\b/i],
  'Network':          [/\bnetwork.security\b/i, /\btippingpoint\b/i, /\bnetwork.defense\b/i, /\bids\b/i, /\bips\b/i],
  'Cloud':            [/\bcloud.security\b/i, /\bcloud.one\b/i, /\bcontainer.security\b/i, /\bcloud.posture\b/i],
  'Risk Insights':    [/\brisk.insight/i, /\brisk.index\b/i, /\bcyber.risk\b/i, /\brisk.score\b/i],
  'Workbench':        [/\bworkbench\b/i, /\binvestigation\b/i, /\bincident.response\b/i],
  'Threat Intel':     [/\bthreat.intel/i, /\bthreat.encyclop/i, /\bioc\b/i, /\bsweeping\b/i],
  'ASRM':             [/\basrm\b/i, /\battack.surface/i, /\bexposure.management\b/i, /\basset.discovery\b/i],
  'Zero Trust':       [/\bztsa\b/i, /\bzero.trust\b/i, /\bsecure.access\b/i],
};

/**
 * Match screenshots to a click event by timestamp (within window).
 *
 * @param {number} clickTs     - click timestamp in ms
 * @param {Array}  screenshots - [{timestamp, url}, ...]
 * @param {number} windowMs    - match window in ms (default 2000)
 * @returns {string[]} matching screenshot URLs
 */
function matchScreenshots(clickTs, screenshots, windowMs) {
  if (!screenshots || !screenshots.length) return [];
  const w = windowMs ?? SCREENSHOT_MATCH_WINDOW_MS;
  return screenshots
    .filter((s) => Math.abs(s.timestamp - clickTs) <= w)
    .map((s) => s.url);
}

/**
 * Detect product interest topics from a URL and/or text.
 *
 * @param {string} [url]  - click URL
 * @param {string} [text] - transcript text
 * @returns {string[]} matched topic names
 */
function detectTopics(url, text) {
  const combined = [url || '', text || ''].join(' ');
  if (!combined.trim()) return [];

  const found = [];
  for (const [topic, patterns] of Object.entries(PRODUCT_TOPICS)) {
    for (const re of patterns) {
      if (re.test(combined)) {
        found.push(topic);
        break;
      }
    }
  }
  return found;
}

/**
 * Calculate engagement score for a timeline segment.
 *
 * - high:   clicks > 0 AND has dialogue
 * - medium: clicks > 0 OR has dialogue (but not both)
 * - low:    neither clicks nor dialogue (silence)
 *
 * @param {number}  clickCount    - number of clicks in segment
 * @param {boolean} hasDialogue   - whether transcript text exists
 * @returns {string} 'high' | 'medium' | 'low'
 */
function engagementScore(clickCount, hasDialogue) {
  if (clickCount > 0 && hasDialogue) return 'high';
  if (clickCount > 0 || hasDialogue) return 'medium';
  return 'low';
}

/**
 * Correlate clicks, transcript segments, and screenshots into an enriched
 * timeline.
 *
 * @param {Object}   data
 * @param {Array}    data.clicks       - [{timestamp, url, element}, ...]
 * @param {Array}    data.transcript   - [{start, end, text}, ...]  (times in ms)
 * @param {Array}    data.screenshots  - [{timestamp, url}, ...]
 * @param {Object}   [opts]
 * @param {number}   [opts.segmentMs]  - segment size in ms (default 30000)
 * @param {number}   [opts.windowMs]   - screenshot match window (default 2000)
 * @returns {Object} { segments: [...], summary: {...} }
 */
function correlate(data, opts) {
  const { clicks = [], transcript = [], screenshots = [] } = data || {};
  const segmentMs = (opts && opts.segmentMs) || 30000;
  const windowMs = (opts && opts.windowMs) || SCREENSHOT_MATCH_WINDOW_MS;

  // Find timeline bounds
  const allTimestamps = [
    ...clicks.map((c) => c.timestamp),
    ...transcript.map((t) => t.start),
    ...transcript.map((t) => t.end),
    ...screenshots.map((s) => s.timestamp),
  ].filter((t) => typeof t === 'number' && !isNaN(t));

  if (allTimestamps.length === 0) {
    return { segments: [], summary: { totalSegments: 0, topics: [], avgEngagement: 'low' } };
  }

  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);

  // Build segments
  const segments = [];
  for (let start = minTs; start <= maxTs; start += segmentMs) {
    const end = start + segmentMs;

    // Clicks in this segment
    const segClicks = clicks.filter((c) => c.timestamp >= start && c.timestamp < end);

    // Transcript text overlapping this segment
    const segTranscript = transcript.filter(
      (t) => t.start < end && t.end > start,
    );
    const dialogueText = segTranscript.map((t) => t.text).join(' ').trim();
    const hasDialogue = dialogueText.length > 0;

    // Screenshot refs for each click
    const clickEvents = segClicks.map((c) => ({
      timestamp: c.timestamp,
      url: c.url || null,
      element: c.element || null,
      screenshot_urls: matchScreenshots(c.timestamp, screenshots, windowMs),
    }));

    // Topics from click URLs + transcript text
    const segTopics = new Set();
    for (const c of segClicks) {
      for (const t of detectTopics(c.url, null)) segTopics.add(t);
    }
    for (const t of detectTopics(null, dialogueText)) segTopics.add(t);

    const score = engagementScore(segClicks.length, hasDialogue);

    segments.push({
      start,
      end,
      engagement_score: score,
      topics: [...segTopics],
      clicks: clickEvents,
      transcript_text: dialogueText || null,
      screenshot_urls: [...new Set(clickEvents.flatMap((c) => c.screenshot_urls))],
    });
  }

  // Summary
  const allTopics = [...new Set(segments.flatMap((s) => s.topics))];
  const scoreCounts = { high: 0, medium: 0, low: 0 };
  for (const s of segments) scoreCounts[s.engagement_score]++;

  let avgEngagement = 'low';
  if (scoreCounts.high >= segments.length / 2) avgEngagement = 'high';
  else if (scoreCounts.high + scoreCounts.medium >= segments.length / 2) avgEngagement = 'medium';

  return {
    segments,
    summary: {
      totalSegments: segments.length,
      topics: allTopics,
      avgEngagement,
      scoreCounts,
    },
  };
}

/**
 * Build a product coverage matrix from correlator output.
 *
 * For each product in PRODUCT_TOPICS, determines:
 * - mentioned: was it found in any transcript text?
 * - clicked: was it found in any click URL?
 * - interestLevel: 'high' | 'medium' | 'low' | 'none'
 * - followUpRelevance: 'high' | 'medium' | 'low'
 *
 * @param {Object} correlatorOutput - return value of correlate()
 * @returns {Object[]} array of { product, mentioned, clicked, interestLevel, followUpRelevance }
 */
function buildCoverageMatrix(correlatorOutput) {
  const { segments = [] } = correlatorOutput || {};
  const products = Object.keys(PRODUCT_TOPICS);

  return products.map((product) => {
    const patterns = PRODUCT_TOPICS[product];
    let mentioned = false;
    let clicked = false;
    let mentionSegments = 0;
    let clickSegments = 0;
    let highEngagementHits = 0;

    for (const seg of segments) {
      const text = seg.transcript_text || '';
      const segMentioned = patterns.some((re) => re.test(text));
      const segClicked = (seg.clicks || []).some((c) =>
        patterns.some((re) => re.test(c.url || '')),
      );

      if (segMentioned) { mentioned = true; mentionSegments++; }
      if (segClicked) { clicked = true; clickSegments++; }
      if ((segMentioned || segClicked) && seg.engagement_score === 'high') {
        highEngagementHits++;
      }
    }

    // Interest level based on signal strength
    let interestLevel = 'none';
    if (mentioned && clicked) {
      interestLevel = highEngagementHits > 0 ? 'high' : 'medium';
    } else if (mentioned || clicked) {
      interestLevel = mentionSegments + clickSegments > 1 ? 'medium' : 'low';
    }

    // Follow-up relevance: high if actively discussed + clicked, low if absent
    let followUpRelevance = 'low';
    if (interestLevel === 'high') followUpRelevance = 'high';
    else if (interestLevel === 'medium') followUpRelevance = 'medium';

    return { product, mentioned, clicked, interestLevel, followUpRelevance };
  });
}

module.exports = {
  correlate,
  buildCoverageMatrix,
  matchScreenshots,
  detectTopics,
  engagementScore,
  PRODUCT_TOPICS,
};
