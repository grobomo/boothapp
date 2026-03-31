/**
 * BoothApp Session Timeline
 * Horizontal timeline visualization for a booth demo session.
 * Click events appear as markers; transcript segments as colored bars.
 * Hover for details, screenshots, and dialogue text.
 *
 * Usage: new BoothTimeline({ container: '#timeline-mount' })
 */
(function (root) {
    'use strict';

    // ------------------------------------------------------------------
    // MOCK SESSION DATA
    // ------------------------------------------------------------------
    var SESSION_START = new Date('2026-03-31T14:00:00Z').getTime();
    var SESSION_END   = new Date('2026-03-31T14:28:00Z').getTime();

    var MOCK_CLICKS = [
        { timestamp: SESSION_START + 30000,  url: 'https://portal.trendmicro.com/xdr/dashboard', element: 'Navigation > XDR Dashboard', x: 240, y: 85, screenshot: null },
        { timestamp: SESSION_START + 120000, url: 'https://portal.trendmicro.com/xdr/alerts', element: 'Button > View Active Alerts', x: 580, y: 320, screenshot: null },
        { timestamp: SESSION_START + 210000, url: 'https://portal.trendmicro.com/xdr/alerts/detail', element: 'Alert Row > Suspicious PowerShell', x: 400, y: 410, screenshot: null },
        { timestamp: SESSION_START + 360000, url: 'https://portal.trendmicro.com/cloud-security', element: 'Navigation > Cloud Security', x: 60, y: 180, screenshot: null },
        { timestamp: SESSION_START + 480000, url: 'https://portal.trendmicro.com/cloud-security/containers', element: 'Tab > Container Protection', x: 320, y: 140, screenshot: null },
        { timestamp: SESSION_START + 600000, url: 'https://portal.trendmicro.com/cloud-security/containers/policies', element: 'Button > Add Runtime Policy', x: 710, y: 290, screenshot: null },
        { timestamp: SESSION_START + 780000, url: 'https://portal.trendmicro.com/ztsa', element: 'Navigation > Zero Trust', x: 60, y: 260, screenshot: null },
        { timestamp: SESSION_START + 900000, url: 'https://portal.trendmicro.com/ztsa/access-rules', element: 'Button > Create Access Rule', x: 640, y: 180, screenshot: null },
        { timestamp: SESSION_START + 1080000, url: 'https://portal.trendmicro.com/email-security', element: 'Navigation > Email Security', x: 60, y: 340, screenshot: null },
        { timestamp: SESSION_START + 1260000, url: 'https://portal.trendmicro.com/email-security/bec', element: 'Link > BEC Protection Dashboard', x: 380, y: 250, screenshot: null },
        { timestamp: SESSION_START + 1500000, url: 'https://portal.trendmicro.com/xdr/dashboard', element: 'Navigation > Back to XDR', x: 60, y: 85, screenshot: null },
        { timestamp: SESSION_START + 1620000, url: 'https://portal.trendmicro.com/xdr/search', element: 'Button > Threat Hunting Query', x: 520, y: 160, screenshot: null }
    ];

    var TOPIC_COLORS = {
        'XDR':            'var(--red)',
        'Cloud Security': 'var(--blue)',
        'Zero Trust':     'var(--amber)',
        'Email Security': '#AB47BC'
    };

    var MOCK_TRANSCRIPT = [
        { start: SESSION_START,          end: SESSION_START + 15000,  speaker: 'rep',     text: 'Welcome Sarah! Let me show you our unified security platform. What are your top priorities right now?', topic: 'XDR' },
        { start: SESSION_START + 15000,  end: SESSION_START + 45000,  speaker: 'visitor', text: 'We need to consolidate our SIEM and EDR tools. We have too many dashboards and our SOC team is drowning in alerts.', topic: 'XDR' },
        { start: SESSION_START + 45000,  end: SESSION_START + 90000,  speaker: 'rep',     text: 'That is exactly what Vision One XDR solves. Let me pull up the dashboard -- see how it correlates alerts from endpoints, email, and network into a single prioritized view.', topic: 'XDR' },
        { start: SESSION_START + 90000,  end: SESSION_START + 150000, speaker: 'visitor', text: 'Oh interesting -- so this suspicious PowerShell alert is already linked to the phishing email that delivered it? We would need three tools to see that today.', topic: 'XDR' },
        { start: SESSION_START + 150000, end: SESSION_START + 240000, speaker: 'rep',     text: 'Exactly. Root cause analysis is automatic. Now let me show you something else -- you mentioned running Kubernetes workloads in AWS...', topic: 'XDR' },
        { start: SESSION_START + 240000, end: SESSION_START + 330000, speaker: 'visitor', text: 'Yes, we have about 200 pods in EKS. Our biggest concern is container image vulnerabilities and runtime protection. We currently scan in CI but have nothing in production.', topic: 'Cloud Security' },
        { start: SESSION_START + 330000, end: SESSION_START + 450000, speaker: 'rep',     text: 'Cloud Security container protection covers both. Here is the scanning view -- it catches vulnerabilities before deployment. And the runtime policies detect anomalous behavior in running containers.', topic: 'Cloud Security' },
        { start: SESSION_START + 450000, end: SESSION_START + 540000, speaker: 'visitor', text: 'Can it integrate with our admission controller to block vulnerable images from deploying?', topic: 'Cloud Security' },
        { start: SESSION_START + 540000, end: SESSION_START + 660000, speaker: 'rep',     text: 'Absolutely. Let me show you the policy builder -- you can set severity thresholds and auto-block. Now, you also mentioned ZTNA. Let me switch to our Zero Trust module.', topic: 'Cloud Security' },
        { start: SESSION_START + 660000, end: SESSION_START + 780000, speaker: 'visitor', text: 'Right. Our VPN is a nightmare. Slow, hard to manage, and we have zero visibility into what users are accessing remotely.', topic: 'Zero Trust' },
        { start: SESSION_START + 780000, end: SESSION_START + 900000, speaker: 'rep',     text: 'Zero Trust Secure Access replaces VPN entirely. Users get seamless access to apps with device posture checks. Let me create a sample access rule to show you.', topic: 'Zero Trust' },
        { start: SESSION_START + 900000, end: SESSION_START + 1020000, speaker: 'visitor', text: 'And it checks the device security posture before granting access? Can we require specific endpoint agent versions?', topic: 'Zero Trust' },
        { start: SESSION_START + 1020000, end: SESSION_START + 1140000, speaker: 'rep',    text: 'Yes -- posture profiles are fully customizable. You can require OS patch level, agent version, disk encryption, and more. Now let me show you email protection since you mentioned BEC incidents.', topic: 'Zero Trust' },
        { start: SESSION_START + 1140000, end: SESSION_START + 1320000, speaker: 'visitor', text: 'We had two BEC incidents last quarter. The CFO nearly wired $200K. Our current email gateway did not catch the impersonation.', topic: 'Email Security' },
        { start: SESSION_START + 1320000, end: SESSION_START + 1500000, speaker: 'rep',    text: 'Our BEC detection uses writing style analysis and header anomaly detection. It caught 99.8% of impersonation attempts in independent testing. Look at this dashboard showing blocked attempts in real time.', topic: 'Email Security' },
        { start: SESSION_START + 1500000, end: SESSION_START + 1620000, speaker: 'visitor', text: 'That is impressive. So all of this -- XDR, cloud, zero trust, email -- is in one console?', topic: 'XDR' },
        { start: SESSION_START + 1620000, end: SESSION_START + 1680000, speaker: 'rep',    text: 'One platform, one console, one data lake. Let me run a quick threat hunting query to show you the power of correlated data across all those layers.', topic: 'XDR' }
    ];

    // ------------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------------
    function fmtTime(ms) {
        var d = new Date(ms);
        var h = d.getUTCHours();
        var m = d.getUTCMinutes();
        var s = d.getUTCSeconds();
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function pct(ts, start, duration) {
        return Math.max(0, Math.min(100, ((ts - start) / duration) * 100));
    }

    // ------------------------------------------------------------------
    // CSS
    // ------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('boothapp-timeline-styles')) return;
        var style = document.createElement('style');
        style.id = 'boothapp-timeline-styles';
        style.textContent = [
            '/* ---- Timeline Section ---- */',
            '.timeline-section {',
            '  background: var(--surface, #0E1118);',
            '  border: 1px solid var(--border, #1E2330);',
            '  border-radius: 16px;',
            '  padding: 24px 28px;',
            '  margin-top: 24px;',
            '  position: relative;',
            '}',
            '.timeline-header {',
            '  display: flex;',
            '  align-items: center;',
            '  justify-content: space-between;',
            '  margin-bottom: 20px;',
            '}',
            '.timeline-title {',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 10px;',
            '  font-size: 15px;',
            '  font-weight: 700;',
            '  color: var(--text, #F0F2F5);',
            '  letter-spacing: .5px;',
            '}',
            '.timeline-title svg {',
            '  width: 20px; height: 20px;',
            '  fill: var(--text-dim, #6B7385);',
            '}',
            '.timeline-meta {',
            '  font-size: 12px;',
            '  color: var(--text-dim, #6B7385);',
            '}',

            '/* ---- Legend ---- */',
            '.timeline-legend {',
            '  display: flex;',
            '  gap: 16px;',
            '  margin-bottom: 16px;',
            '  flex-wrap: wrap;',
            '}',
            '.timeline-legend-item {',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 6px;',
            '  font-size: 11px;',
            '  color: var(--text-dim, #6B7385);',
            '}',
            '.timeline-legend-swatch {',
            '  width: 12px; height: 12px;',
            '  border-radius: 3px;',
            '  flex-shrink: 0;',
            '}',

            '/* ---- Track area ---- */',
            '.timeline-track-area {',
            '  position: relative;',
            '  padding: 0 40px;',
            '}',

            '/* ---- Time axis ---- */',
            '.timeline-axis {',
            '  position: relative;',
            '  height: 2px;',
            '  background: var(--border, #1E2330);',
            '  border-radius: 1px;',
            '}',
            '.timeline-axis-fill {',
            '  position: absolute;',
            '  inset: 0;',
            '  background: linear-gradient(90deg, var(--red, #D71920), var(--blue, #448AFF));',
            '  border-radius: 1px;',
            '  opacity: .35;',
            '}',

            '/* ---- Tick marks ---- */',
            '.timeline-ticks {',
            '  position: relative;',
            '  height: 20px;',
            '  margin-top: 4px;',
            '}',
            '.timeline-tick {',
            '  position: absolute;',
            '  top: 0;',
            '  transform: translateX(-50%);',
            '  font-size: 10px;',
            '  color: var(--text-dim, #6B7385);',
            '  white-space: nowrap;',
            '}',

            '/* ---- Click markers row ---- */',
            '.timeline-markers {',
            '  position: relative;',
            '  height: 28px;',
            '  margin-bottom: 6px;',
            '}',
            '.timeline-marker {',
            '  position: absolute;',
            '  top: 4px;',
            '  width: 12px; height: 12px;',
            '  border-radius: 50%;',
            '  background: var(--red, #D71920);',
            '  border: 2px solid var(--surface, #0E1118);',
            '  transform: translateX(-50%);',
            '  cursor: pointer;',
            '  transition: transform .15s, box-shadow .15s;',
            '  z-index: 2;',
            '}',
            '.timeline-marker:hover {',
            '  transform: translateX(-50%) scale(1.6);',
            '  box-shadow: 0 0 0 4px var(--red-glow, rgba(215,25,32,.35));',
            '  z-index: 10;',
            '}',
            '.timeline-marker-line {',
            '  position: absolute;',
            '  top: 18px;',
            '  width: 1px;',
            '  background: var(--red, #D71920);',
            '  opacity: .25;',
            '  transform: translateX(-50%);',
            '  pointer-events: none;',
            '}',

            '/* ---- Transcript bars row ---- */',
            '.timeline-transcript-row {',
            '  position: relative;',
            '  height: 24px;',
            '  margin-top: 8px;',
            '}',
            '.timeline-transcript-row-label {',
            '  position: absolute;',
            '  left: -40px;',
            '  top: 50%;',
            '  transform: translateY(-50%);',
            '  font-size: 9px;',
            '  text-transform: uppercase;',
            '  letter-spacing: .08em;',
            '  color: var(--text-dim, #6B7385);',
            '  width: 36px;',
            '  text-align: right;',
            '}',
            '.timeline-seg {',
            '  position: absolute;',
            '  top: 2px;',
            '  height: 20px;',
            '  border-radius: 4px;',
            '  cursor: pointer;',
            '  opacity: .65;',
            '  transition: opacity .15s, transform .15s;',
            '  min-width: 4px;',
            '}',
            '.timeline-seg:hover {',
            '  opacity: 1;',
            '  transform: scaleY(1.25);',
            '  z-index: 10;',
            '}',

            '/* ---- Tooltip ---- */',
            '.timeline-tooltip {',
            '  position: fixed;',
            '  z-index: 9999;',
            '  background: var(--surface2, #151920);',
            '  border: 1px solid var(--border, #1E2330);',
            '  border-radius: 10px;',
            '  padding: 14px 16px;',
            '  max-width: 360px;',
            '  box-shadow: 0 12px 40px rgba(0,0,0,.6);',
            '  pointer-events: none;',
            '  opacity: 0;',
            '  transition: opacity .15s;',
            '  font-size: 12px;',
            '  color: var(--text, #F0F2F5);',
            '  line-height: 1.5;',
            '}',
            '.timeline-tooltip.visible { opacity: 1; }',
            '.timeline-tooltip-time {',
            '  font-size: 10px;',
            '  color: var(--text-dim, #6B7385);',
            '  margin-bottom: 6px;',
            '  font-family: monospace;',
            '}',
            '.timeline-tooltip-label {',
            '  font-weight: 700;',
            '  margin-bottom: 4px;',
            '}',
            '.timeline-tooltip-url {',
            '  font-size: 11px;',
            '  color: var(--blue, #448AFF);',
            '  word-break: break-all;',
            '  margin-top: 4px;',
            '}',
            '.timeline-tooltip-element {',
            '  font-size: 11px;',
            '  color: var(--text-dim, #6B7385);',
            '  margin-top: 2px;',
            '}',
            '.timeline-tooltip-screenshot {',
            '  width: 100%;',
            '  max-width: 320px;',
            '  border-radius: 6px;',
            '  margin-top: 8px;',
            '  border: 1px solid var(--border, #1E2330);',
            '}',
            '.timeline-tooltip-speaker {',
            '  font-size: 10px;',
            '  text-transform: uppercase;',
            '  letter-spacing: .08em;',
            '  margin-bottom: 4px;',
            '}',
            '.timeline-tooltip-speaker--rep   { color: var(--blue, #448AFF); }',
            '.timeline-tooltip-speaker--visitor { color: var(--amber, #FFAB00); }',
            '.timeline-tooltip-text {',
            '  font-style: italic;',
            '  color: var(--text, #F0F2F5);',
            '}',
            '.timeline-tooltip-topic {',
            '  display: inline-block;',
            '  font-size: 10px;',
            '  padding: 1px 6px;',
            '  border-radius: 4px;',
            '  margin-top: 6px;',
            '  font-weight: 600;',
            '}',

            '/* ---- Responsive ---- */',
            '@media (max-width: 600px) {',
            '  .timeline-track-area { padding: 0 24px; }',
            '  .timeline-transcript-row-label { display: none; }',
            '  .timeline-section { padding: 16px; }',
            '  .timeline-legend { gap: 10px; }',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------
    // COMPONENT
    // ------------------------------------------------------------------
    function BoothTimeline(opts) {
        opts = opts || {};
        this.containerSelector = opts.container || '#timeline-mount';
        this.clicks = opts.clicks || MOCK_CLICKS;
        this.transcript = opts.transcript || MOCK_TRANSCRIPT;
        this.sessionStart = opts.sessionStart || SESSION_START;
        this.sessionEnd = opts.sessionEnd || SESSION_END;
        this.duration = this.sessionEnd - this.sessionStart;

        this._tooltip = null;

        injectStyles();
        this._createTooltip();
        this._mount();
    }

    // ------------------------------------------------------------------
    // TOOLTIP
    // ------------------------------------------------------------------
    BoothTimeline.prototype._createTooltip = function () {
        this._tooltip = document.createElement('div');
        this._tooltip.className = 'timeline-tooltip';
        document.body.appendChild(this._tooltip);
    };

    BoothTimeline.prototype._showTooltip = function (html, e) {
        this._tooltip.innerHTML = html;
        this._tooltip.classList.add('visible');
        this._positionTooltip(e);
    };

    BoothTimeline.prototype._hideTooltip = function () {
        this._tooltip.classList.remove('visible');
    };

    BoothTimeline.prototype._positionTooltip = function (e) {
        var tt = this._tooltip;
        var pad = 12;
        var x = e.clientX + pad;
        var y = e.clientY + pad;
        // Measure after content is set
        var rect = tt.getBoundingClientRect();
        if (x + rect.width > window.innerWidth - pad) {
            x = e.clientX - rect.width - pad;
        }
        if (y + rect.height > window.innerHeight - pad) {
            y = e.clientY - rect.height - pad;
        }
        tt.style.left = x + 'px';
        tt.style.top = y + 'px';
    };

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------
    BoothTimeline.prototype._mount = function () {
        var target = document.querySelector(this.containerSelector);
        if (!target) return;

        var self = this;
        var dur = this.duration;
        var start = this.sessionStart;

        // -- Build topic color map --
        var topics = {};
        for (var i = 0; i < this.transcript.length; i++) {
            var t = this.transcript[i].topic;
            if (t && !topics[t]) {
                topics[t] = TOPIC_COLORS[t] || 'var(--text-dim)';
            }
        }

        // -- Legend --
        var legendHtml = '';
        var topicNames = Object.keys(topics);
        for (var li = 0; li < topicNames.length; li++) {
            legendHtml +=
                '<div class="timeline-legend-item">' +
                    '<span class="timeline-legend-swatch" style="background:' + topics[topicNames[li]] + '"></span>' +
                    escapeHtml(topicNames[li]) +
                '</div>';
        }

        // -- Tick marks (every 5 min) --
        var tickInterval = 5 * 60 * 1000;
        var ticksHtml = '';
        for (var ts = start; ts <= this.sessionEnd; ts += tickInterval) {
            var left = pct(ts, start, dur);
            ticksHtml += '<span class="timeline-tick" style="left:' + left + '%">' + fmtTime(ts) + '</span>';
        }
        // Always add end tick if not aligned
        var lastTick = start + Math.floor(dur / tickInterval) * tickInterval;
        if (lastTick < this.sessionEnd - 30000) {
            ticksHtml += '<span class="timeline-tick" style="left:100%">' + fmtTime(this.sessionEnd) + '</span>';
        }

        // -- Click markers --
        var markersHtml = '';
        for (var ci = 0; ci < this.clicks.length; ci++) {
            var c = this.clicks[ci];
            var leftPct = pct(c.timestamp, start, dur);
            markersHtml += '<div class="timeline-marker" style="left:' + leftPct + '%" data-click-idx="' + ci + '"></div>';
            // Vertical guide line from marker down to transcript rows
            markersHtml += '<div class="timeline-marker-line" style="left:' + leftPct + '%; height: 70px;"></div>';
        }

        // -- Transcript segments, split by speaker --
        var repHtml = '';
        var visitorHtml = '';
        for (var si = 0; si < this.transcript.length; si++) {
            var seg = this.transcript[si];
            var segLeft = pct(seg.start, start, dur);
            var segWidth = pct(seg.end, start, dur) - segLeft;
            var color = topics[seg.topic] || 'var(--text-dim)';
            var bar = '<div class="timeline-seg" style="left:' + segLeft + '%;width:' + segWidth + '%;background:' + color + ';" data-seg-idx="' + si + '"></div>';
            if (seg.speaker === 'rep') {
                repHtml += bar;
            } else {
                visitorHtml += bar;
            }
        }

        // -- Session duration string --
        var mins = Math.round(dur / 60000);
        var durationStr = mins + ' min session';

        // -- Assemble --
        target.innerHTML =
            '<section class="timeline-section">' +
                '<div class="timeline-header">' +
                    '<div class="timeline-title">' +
                        '<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>' +
                        'Session Timeline' +
                    '</div>' +
                    '<span class="timeline-meta">' + fmtTime(start) + ' -- ' + fmtTime(this.sessionEnd) + ' | ' + durationStr + ' | ' + this.clicks.length + ' clicks</span>' +
                '</div>' +
                '<div class="timeline-legend">' + legendHtml + '</div>' +
                '<div class="timeline-track-area">' +
                    '<div class="timeline-markers">' + markersHtml + '</div>' +
                    '<div class="timeline-axis"><div class="timeline-axis-fill"></div></div>' +
                    '<div class="timeline-ticks">' + ticksHtml + '</div>' +
                    '<div class="timeline-transcript-row">' +
                        '<span class="timeline-transcript-row-label">Rep</span>' +
                        repHtml +
                    '</div>' +
                    '<div class="timeline-transcript-row">' +
                        '<span class="timeline-transcript-row-label">Visitor</span>' +
                        visitorHtml +
                    '</div>' +
                '</div>' +
            '</section>';

        // -- Bind hover events for markers --
        var markers = target.querySelectorAll('.timeline-marker');
        for (var mi = 0; mi < markers.length; mi++) {
            (function (el) {
                var idx = parseInt(el.getAttribute('data-click-idx'), 10);
                var click = self.clicks[idx];

                el.addEventListener('mouseenter', function (e) {
                    var html =
                        '<div class="timeline-tooltip-time">' + fmtTime(click.timestamp) + '</div>' +
                        '<div class="timeline-tooltip-label">Click #' + (idx + 1) + '</div>' +
                        '<div class="timeline-tooltip-element">' + escapeHtml(click.element) + '</div>' +
                        '<div class="timeline-tooltip-url">' + escapeHtml(click.url) + '</div>';
                    if (click.screenshot) {
                        html += '<img class="timeline-tooltip-screenshot" src="' + escapeHtml(click.screenshot) + '" alt="Screenshot" />';
                    }
                    self._showTooltip(html, e);
                });
                el.addEventListener('mousemove', function (e) {
                    self._positionTooltip(e);
                });
                el.addEventListener('mouseleave', function () {
                    self._hideTooltip();
                });
            })(markers[mi]);
        }

        // -- Bind hover events for transcript segments --
        var segs = target.querySelectorAll('.timeline-seg');
        for (var si2 = 0; si2 < segs.length; si2++) {
            (function (el) {
                var idx = parseInt(el.getAttribute('data-seg-idx'), 10);
                var seg = self.transcript[idx];

                el.addEventListener('mouseenter', function (e) {
                    var speakerClass = seg.speaker === 'rep' ? 'rep' : 'visitor';
                    var speakerLabel = seg.speaker === 'rep' ? 'Sales Rep' : 'Visitor';
                    var topicColor = topics[seg.topic] || 'var(--text-dim)';
                    var html =
                        '<div class="timeline-tooltip-time">' + fmtTime(seg.start) + ' -- ' + fmtTime(seg.end) + '</div>' +
                        '<div class="timeline-tooltip-speaker timeline-tooltip-speaker--' + speakerClass + '">' + speakerLabel + '</div>' +
                        '<div class="timeline-tooltip-text">"' + escapeHtml(seg.text) + '"</div>' +
                        '<span class="timeline-tooltip-topic" style="background:' + topicColor + ';color:#fff">' + escapeHtml(seg.topic) + '</span>';
                    self._showTooltip(html, e);
                });
                el.addEventListener('mousemove', function (e) {
                    self._positionTooltip(e);
                });
                el.addEventListener('mouseleave', function () {
                    self._hideTooltip();
                });
            })(segs[si2]);
        }
    };

    // ------------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------------
    BoothTimeline.prototype.update = function (opts) {
        this.clicks = opts.clicks || this.clicks;
        this.transcript = opts.transcript || this.transcript;
        this.sessionStart = opts.sessionStart || this.sessionStart;
        this.sessionEnd = opts.sessionEnd || this.sessionEnd;
        this.duration = this.sessionEnd - this.sessionStart;
        this._mount();
    };

    // ------------------------------------------------------------------
    // EXPORT
    // ------------------------------------------------------------------
    root.BoothTimeline = BoothTimeline;

})(window);
