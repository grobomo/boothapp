/**
 * BoothApp Session Cost Estimator
 *
 * Estimates per-session AWS costs based on the BoothApp S3 data contract:
 *   sessions/<id>/audio.webm, clicks.json, screenshots/, badge.json, ready
 *   sessions/<id>/output/result.json, report.html, follow-up-email.html
 *
 * AWS pricing (us-east-1):
 *   S3 Standard:       $0.023 / GB-month
 *   Lambda:            $0.20 / 1M invocations + $0.0000166667 / GB-second
 *   Transcribe:        $0.024 / minute
 *   Bedrock Sonnet:    $3.00 / 1M input tokens, $15.00 / 1M output tokens
 *   Data Transfer Out: $0.09 / GB (first 10 TB)
 */

var CostEstimator = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Pricing constants
  // ---------------------------------------------------------------------------
  var PRICING = {
    s3PerGBMonth:           0.023,
    lambdaPerInvocation:    0.0000002,   // $0.20 / 1M
    lambdaPerGBSecond:      0.0000166667,
    transcribePerMinute:    0.024,
    bedrockInputPer1MToken: 3.00,
    bedrockOutputPer1MToken: 15.00,
    dataTransferPerGB:      0.09
  };

  // ---------------------------------------------------------------------------
  // Typical session profile (derived from S3 data contract)
  // ---------------------------------------------------------------------------
  var SESSION_DEFAULTS = {
    audioSizeMB:          2.5,    // ~5 min WebM audio
    clicksJsonKB:         12,     // ~40 click events
    screenshotCount:      8,      // JPEG frames per session
    screenshotSizeKB:     45,     // avg per screenshot
    badgeJsonKB:          0.5,
    readyFileKB:          0.001,
    metadataMiscKB:       2,

    // Analysis output
    resultJsonKB:         15,
    reportHtmlKB:         25,
    followUpEmailKB:      8,

    // Transcribe
    audioMinutes:         5,

    // Bedrock (Claude Sonnet) -- analysis prompt
    bedrockInputTokens:   4000,   // transcript + correlation context
    bedrockOutputTokens:  2000,   // analysis + follow-up

    // Lambda -- 2 invocations per session (create pre-signed URL + end/trigger)
    lambdaInvocations:    2,
    lambdaMemoryMB:       256,
    lambdaDurationMs:     200
  };

  // ---------------------------------------------------------------------------
  // Core estimation
  // ---------------------------------------------------------------------------

  function estimateSession(overrides) {
    var s = {};
    var key;
    for (key in SESSION_DEFAULTS) {
      s[key] = SESSION_DEFAULTS[key];
    }
    if (overrides) {
      for (key in overrides) {
        s[key] = overrides[key];
      }
    }

    // S3 storage
    var storageMB =
      s.audioSizeMB +
      (s.clicksJsonKB / 1024) +
      (s.screenshotCount * s.screenshotSizeKB / 1024) +
      (s.badgeJsonKB / 1024) +
      (s.readyFileKB / 1024) +
      (s.metadataMiscKB / 1024) +
      (s.resultJsonKB / 1024) +
      (s.reportHtmlKB / 1024) +
      (s.followUpEmailKB / 1024);
    var storageGB = storageMB / 1024;
    var s3Cost = storageGB * PRICING.s3PerGBMonth;

    // Lambda
    var lambdaInvCost = s.lambdaInvocations * PRICING.lambdaPerInvocation;
    var lambdaComputeGB = (s.lambdaMemoryMB / 1024) * (s.lambdaDurationMs / 1000);
    var lambdaComputeCost = s.lambdaInvocations * lambdaComputeGB * PRICING.lambdaPerGBSecond;
    var lambdaCost = lambdaInvCost + lambdaComputeCost;

    // Transcribe
    var transcribeCost = s.audioMinutes * PRICING.transcribePerMinute;

    // Bedrock
    var bedrockInputCost = (s.bedrockInputTokens / 1000000) * PRICING.bedrockInputPer1MToken;
    var bedrockOutputCost = (s.bedrockOutputTokens / 1000000) * PRICING.bedrockOutputPer1MToken;
    var bedrockCost = bedrockInputCost + bedrockOutputCost;

    // Data transfer (download report + email)
    var transferMB = (s.reportHtmlKB + s.followUpEmailKB + s.resultJsonKB) / 1024;
    var transferGB = transferMB / 1024;
    var transferCost = transferGB * PRICING.dataTransferPerGB;

    var totalCost = s3Cost + lambdaCost + transcribeCost + bedrockCost + transferCost;

    return {
      s3:         { cost: s3Cost,         storageMB: storageMB },
      lambda:     { cost: lambdaCost,     invocations: s.lambdaInvocations },
      transcribe: { cost: transcribeCost, minutes: s.audioMinutes },
      bedrock:    { cost: bedrockCost,    inputTokens: s.bedrockInputTokens, outputTokens: s.bedrockOutputTokens },
      transfer:   { cost: transferCost,   transferMB: transferMB },
      total:      totalCost
    };
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------

  function formatUSD(n) {
    if (n < 0.01) return '$' + n.toFixed(6);
    if (n < 1)    return '$' + n.toFixed(4);
    return '$' + n.toFixed(2);
  }

  function formatPct(part, total) {
    if (total === 0) return '0%';
    return Math.round((part / total) * 100) + '%';
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // ---------------------------------------------------------------------------

  function renderCard(estimate, sessionCount) {
    var total = estimate.total;
    var runningTotal = total * sessionCount;

    var lines = [
      { label: 'S3 Storage',       cost: estimate.s3.cost,         detail: estimate.s3.storageMB.toFixed(1) + ' MB' },
      { label: 'Lambda',           cost: estimate.lambda.cost,     detail: estimate.lambda.invocations + ' inv' },
      { label: 'Transcribe',       cost: estimate.transcribe.cost, detail: estimate.transcribe.minutes + ' min' },
      { label: 'Bedrock (Sonnet)', cost: estimate.bedrock.cost,    detail: (estimate.bedrock.inputTokens + estimate.bedrock.outputTokens).toLocaleString() + ' tok' },
      { label: 'Data Transfer',    cost: estimate.transfer.cost,   detail: estimate.transfer.transferMB.toFixed(2) + ' MB' }
    ];

    var html = '';
    html += '<div class="cost-card">';
    html += '<div class="cost-card-title">';
    html += '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>';
    html += ' AWS Cost Estimate';
    html += '</div>';

    html += '<table class="cost-table">';
    html += '<thead><tr><th>Service</th><th>Detail</th><th>Cost</th><th></th></tr></thead>';
    html += '<tbody>';

    for (var i = 0; i < lines.length; i++) {
      var pct = formatPct(lines[i].cost, total);
      html += '<tr>';
      html += '<td class="cost-service">' + lines[i].label + '</td>';
      html += '<td class="cost-detail">' + lines[i].detail + '</td>';
      html += '<td class="cost-amount">' + formatUSD(lines[i].cost) + '</td>';
      html += '<td class="cost-pct">' + pct + '</td>';
      html += '</tr>';
    }

    html += '</tbody>';
    html += '<tfoot>';
    html += '<tr class="cost-total-row"><td colspan="2">Per Session</td><td colspan="2">' + formatUSD(total) + '</td></tr>';
    html += '<tr class="cost-running-row"><td colspan="2">Running Total (' + sessionCount + ' sessions)</td><td colspan="2">' + formatUSD(runningTotal) + '</td></tr>';
    html += '</tfoot>';
    html += '</table>';

    // Dominant cost bar
    html += '<div class="cost-bar">';
    var colors = ['#D71920', '#448AFF', '#00E676', '#FFAB00', '#6B7385'];
    for (var j = 0; j < lines.length; j++) {
      var w = total > 0 ? (lines[j].cost / total) * 100 : 0;
      if (w > 0.5) {
        html += '<div class="cost-bar-segment" style="width:' + w.toFixed(1) + '%;background:' + colors[j] + '" title="' + lines[j].label + ': ' + formatUSD(lines[j].cost) + '"></div>';
      }
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ---------------------------------------------------------------------------
  // Inline styles (injected once)
  // ---------------------------------------------------------------------------

  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var css = [
      '.cost-card {',
      '  background: var(--surface, #0E1118);',
      '  border: 1px solid var(--border, #1E2330);',
      '  border-radius: 16px;',
      '  padding: 20px;',
      '  font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;',
      '  color: var(--text, #F0F2F5);',
      '  max-width: 420px;',
      '}',
      '.cost-card-title {',
      '  font-size: 13px;',
      '  font-weight: 700;',
      '  text-transform: uppercase;',
      '  letter-spacing: 1.5px;',
      '  color: var(--text-dim, #6B7385);',
      '  margin-bottom: 16px;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '}',
      '.cost-table {',
      '  width: 100%;',
      '  border-collapse: collapse;',
      '  font-size: 13px;',
      '}',
      '.cost-table th {',
      '  text-align: left;',
      '  font-size: 11px;',
      '  font-weight: 600;',
      '  color: var(--text-dim, #6B7385);',
      '  text-transform: uppercase;',
      '  letter-spacing: 1px;',
      '  padding: 0 0 8px 0;',
      '  border-bottom: 1px solid var(--border, #1E2330);',
      '}',
      '.cost-table td {',
      '  padding: 6px 0;',
      '  border-bottom: 1px solid rgba(255,255,255,.03);',
      '}',
      '.cost-service { color: var(--text, #F0F2F5); font-weight: 500; }',
      '.cost-detail  { color: var(--text-dim, #6B7385); font-size: 12px; }',
      '.cost-amount  { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }',
      '.cost-pct     { text-align: right; color: var(--text-dim, #6B7385); font-size: 11px; padding-left: 6px; width: 36px; }',
      '.cost-table tfoot td {',
      '  padding: 10px 0 4px 0;',
      '  border-bottom: none;',
      '}',
      '.cost-total-row td {',
      '  font-weight: 700;',
      '  font-size: 14px;',
      '  color: var(--text, #F0F2F5);',
      '  border-top: 1px solid var(--border, #1E2330);',
      '}',
      '.cost-running-row td {',
      '  font-weight: 700;',
      '  font-size: 15px;',
      '  color: var(--red, #D71920);',
      '}',
      '.cost-bar {',
      '  display: flex;',
      '  height: 6px;',
      '  border-radius: 3px;',
      '  overflow: hidden;',
      '  margin-top: 14px;',
      '  background: var(--surface2, #151920);',
      '}',
      '.cost-bar-segment {',
      '  height: 100%;',
      '  transition: width .6s ease;',
      '}'
    ].join('\n');

    var style = document.createElement('style');
    style.setAttribute('data-cost-estimator', '');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Mount the cost estimator card into a container element.
   *
   * @param {string|HTMLElement} container - selector string or DOM element
   * @param {object}  [opts]
   * @param {number}  [opts.sessionCount]    - number of sessions for running total (default: 1)
   * @param {number}  [opts.audioMinutes]    - override audio duration
   * @param {number}  [opts.screenshotCount] - override screenshot count
   * @param {number}  [opts.bedrockInputTokens]  - override input tokens
   * @param {number}  [opts.bedrockOutputTokens] - override output tokens
   */
  function mount(container, opts) {
    injectStyles();

    var el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) {
      console.error('[CostEstimator] Container not found:', container);
      return null;
    }

    opts = opts || {};
    var sessionCount = opts.sessionCount || 1;
    var overrides = {};
    if (opts.audioMinutes !== undefined)       overrides.audioMinutes = opts.audioMinutes;
    if (opts.screenshotCount !== undefined)    overrides.screenshotCount = opts.screenshotCount;
    if (opts.bedrockInputTokens !== undefined) overrides.bedrockInputTokens = opts.bedrockInputTokens;
    if (opts.bedrockOutputTokens !== undefined) overrides.bedrockOutputTokens = opts.bedrockOutputTokens;

    var estimate = estimateSession(overrides);
    el.innerHTML = renderCard(estimate, sessionCount);

    return {
      estimate: estimate,
      update: function (newOpts) {
        newOpts = newOpts || {};
        var sc = newOpts.sessionCount || sessionCount;
        var ov = {};
        if (newOpts.audioMinutes !== undefined)       ov.audioMinutes = newOpts.audioMinutes;
        if (newOpts.screenshotCount !== undefined)    ov.screenshotCount = newOpts.screenshotCount;
        if (newOpts.bedrockInputTokens !== undefined) ov.bedrockInputTokens = newOpts.bedrockInputTokens;
        if (newOpts.bedrockOutputTokens !== undefined) ov.bedrockOutputTokens = newOpts.bedrockOutputTokens;
        var est = estimateSession(ov);
        el.innerHTML = renderCard(est, sc);
        return est;
      }
    };
  }

  return {
    PRICING: PRICING,
    SESSION_DEFAULTS: SESSION_DEFAULTS,
    estimateSession: estimateSession,
    renderCard: renderCard,
    mount: mount,
    formatUSD: formatUSD
  };

})();

// Support both browser global and CommonJS/Node require
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CostEstimator;
}
