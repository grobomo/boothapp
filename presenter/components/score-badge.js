/**
 * ScoreBadge - Reusable engagement score pill component
 *
 * Renders colored pill badges with animated fill and tooltip breakdown.
 * Color coding: green (80-100), yellow (60-79), red (0-59).
 *
 * Usage:
 *   ScoreBadge.render(container, { engagement: 85, coverage: 72, followUp: 60 });
 *   ScoreBadge.renderMini(container, 78, 'Engagement');
 *   ScoreBadge.renderDistributionChart(container, sessionsArray);
 */
(function (root) {
    'use strict';

    // ---- Color helpers ---------------------------------------------------

    function scoreColor(val) {
        if (val >= 80) return { bg: 'rgba(0,230,118,.12)', fill: '#00E676', border: 'rgba(0,230,118,.3)', label: 'High' };
        if (val >= 60) return { bg: 'rgba(255,171,0,.12)',  fill: '#FFAB00', border: 'rgba(255,171,0,.3)',  label: 'Medium' };
        return              { bg: 'rgba(215,25,32,.12)',  fill: '#D71920', border: 'rgba(215,25,32,.3)',  label: 'Low' };
    }

    function overall(scores) {
        return Math.round((scores.engagement + scores.coverage + scores.followUp) / 3);
    }

    // ---- CSS (injected once) ---------------------------------------------

    var CSS_ID = 'score-badge-styles';

    function injectCSS() {
        if (document.getElementById(CSS_ID)) return;
        var style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = [
            '.sb-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px 4px 8px;',
            'border-radius:100px;font-size:12px;font-weight:700;cursor:default;position:relative;',
            'transition:transform .15s;white-space:nowrap}',
            '.sb-pill:hover{transform:scale(1.05)}',
            '.sb-pill:hover .sb-tooltip{opacity:1;visibility:visible;transform:translateY(0)}',

            /* animated bar inside pill */
            '.sb-bar{width:32px;height:6px;border-radius:3px;overflow:hidden;position:relative}',
            '.sb-bar-bg{position:absolute;inset:0;border-radius:3px;opacity:.2}',
            '.sb-bar-fill{height:100%;border-radius:3px;width:0;transition:width .8s cubic-bezier(.25,.46,.45,.94)}',

            /* tooltip */
            '.sb-tooltip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%) translateY(4px);',
            'background:#151920;border:1px solid #1E2330;border-radius:10px;padding:10px 14px;',
            'min-width:180px;opacity:0;visibility:hidden;transition:opacity .2s,transform .2s;',
            'pointer-events:none;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,.4)}',
            '.sb-tooltip::after{content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);',
            'border:6px solid transparent;border-top-color:#1E2330}',
            '.sb-tt-title{font-size:11px;color:#6B7385;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}',
            '.sb-tt-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;font-size:12px}',
            '.sb-tt-row:last-child{margin-bottom:0}',
            '.sb-tt-label{color:#6B7385}',
            '.sb-tt-val{font-weight:700}',
            '.sb-tt-bar{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden;min-width:40px}',
            '.sb-tt-bar-fill{height:100%;border-radius:2px;transition:width .6s ease}',

            /* mini badge (single score) */
            '.sb-mini{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;',
            'border-radius:100px;font-size:11px;font-weight:700}',

            /* distribution chart */
            '.sb-dist{width:100%}',
            '.sb-dist-bars{display:flex;align-items:flex-end;gap:3px;height:120px;margin-bottom:8px}',
            '.sb-dist-bar{flex:1;border-radius:3px 3px 0 0;min-width:0;transition:height .8s cubic-bezier(.25,.46,.45,.94);',
            'position:relative;cursor:default}',
            '.sb-dist-bar:hover .sb-dist-tip{opacity:1}',
            '.sb-dist-tip{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);',
            'background:#151920;border:1px solid #1E2330;border-radius:6px;padding:3px 7px;font-size:10px;',
            'color:#F0F2F5;white-space:nowrap;opacity:0;transition:opacity .15s;pointer-events:none}',
            '.sb-dist-labels{display:flex;justify-content:space-between;font-size:10px;color:#6B7385}',
            '.sb-dist-legend{display:flex;gap:12px;margin-top:8px;font-size:11px;color:#6B7385}',
            '.sb-dist-legend-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ---- Render full badge (3-score breakdown) ---------------------------

    function render(container, scores, opts) {
        injectCSS();
        opts = opts || {};
        var total = overall(scores);
        var c = scoreColor(total);

        var pill = document.createElement('span');
        pill.className = 'sb-pill';
        pill.style.cssText = 'background:' + c.bg + ';border:1px solid ' + c.border + ';color:' + c.fill;

        // Animated bar
        pill.innerHTML =
            '<span class="sb-bar"><span class="sb-bar-bg" style="background:' + c.fill + '"></span>' +
            '<span class="sb-bar-fill" style="background:' + c.fill + '" data-sb-width="' + total + '%"></span></span>' +
            '<span>' + total + '</span>';

        // Tooltip
        var tt = document.createElement('div');
        tt.className = 'sb-tooltip';
        tt.innerHTML =
            '<div class="sb-tt-title">Score Breakdown</div>' +
            _tooltipRow('Engagement', scores.engagement) +
            _tooltipRow('Coverage', scores.coverage) +
            _tooltipRow('Follow-up', scores.followUp);
        pill.appendChild(tt);

        if (typeof container === 'string') container = document.querySelector(container);
        container.appendChild(pill);

        // Trigger animation after append
        requestAnimationFrame(function () {
            var fill = pill.querySelector('.sb-bar-fill');
            if (fill) fill.style.width = fill.getAttribute('data-sb-width');
            // Animate tooltip bars too
            var ttBars = pill.querySelectorAll('.sb-tt-bar-fill');
            for (var i = 0; i < ttBars.length; i++) {
                ttBars[i].style.width = ttBars[i].getAttribute('data-sb-width');
            }
        });

        return pill;
    }

    function _tooltipRow(label, val) {
        var c = scoreColor(val);
        return '<div class="sb-tt-row">' +
            '<span class="sb-tt-label">' + label + '</span>' +
            '<span class="sb-tt-bar"><span class="sb-tt-bar-fill" style="background:' + c.fill + '" data-sb-width="' + val + '%"></span></span>' +
            '<span class="sb-tt-val" style="color:' + c.fill + '">' + val + '</span>' +
            '</div>';
    }

    // ---- Render mini badge (single value) --------------------------------

    function renderMini(container, val, label) {
        injectCSS();
        var c = scoreColor(val);
        var el = document.createElement('span');
        el.className = 'sb-mini';
        el.style.cssText = 'background:' + c.bg + ';border:1px solid ' + c.border + ';color:' + c.fill;
        el.textContent = (label ? label + ': ' : '') + val;
        if (typeof container === 'string') container = document.querySelector(container);
        container.appendChild(el);
        return el;
    }

    // ---- Score Distribution Chart ----------------------------------------

    function renderDistributionChart(container, sessions) {
        injectCSS();
        if (typeof container === 'string') container = document.querySelector(container);

        // Bucket scores into 10-point ranges: 0-9, 10-19, ... 90-100
        var buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 10 buckets
        var bucketLabels = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90-100'];

        sessions.forEach(function (s) {
            var score = overall(s.scores);
            var idx = Math.min(Math.floor(score / 10), 9);
            buckets[idx]++;
        });

        var max = Math.max.apply(null, buckets) || 1;

        var wrap = document.createElement('div');
        wrap.className = 'sb-dist';

        // Bars
        var barsDiv = document.createElement('div');
        barsDiv.className = 'sb-dist-bars';

        buckets.forEach(function (count, i) {
            var bar = document.createElement('div');
            bar.className = 'sb-dist-bar';
            var pct = (count / max) * 100;
            var midScore = i * 10 + 5;
            var c = scoreColor(midScore);
            bar.style.cssText = 'height:0;background:' + c.fill;
            bar.setAttribute('data-sb-height', Math.max(pct, count > 0 ? 4 : 0) + '%');
            bar.innerHTML = '<span class="sb-dist-tip">' + bucketLabels[i] + ': ' + count + '</span>';
            barsDiv.appendChild(bar);
        });

        wrap.appendChild(barsDiv);

        // Labels
        var labelsDiv = document.createElement('div');
        labelsDiv.className = 'sb-dist-labels';
        labelsDiv.innerHTML = '<span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span>';
        wrap.appendChild(labelsDiv);

        // Legend
        var legendDiv = document.createElement('div');
        legendDiv.className = 'sb-dist-legend';
        legendDiv.innerHTML =
            '<span><span class="sb-dist-legend-dot" style="background:#D71920"></span>Low (0-59)</span>' +
            '<span><span class="sb-dist-legend-dot" style="background:#FFAB00"></span>Mid (60-79)</span>' +
            '<span><span class="sb-dist-legend-dot" style="background:#00E676"></span>High (80-100)</span>';
        wrap.appendChild(legendDiv);

        container.appendChild(wrap);

        // Animate bars in
        requestAnimationFrame(function () {
            var bars = barsDiv.querySelectorAll('.sb-dist-bar');
            for (var i = 0; i < bars.length; i++) {
                bars[i].style.height = bars[i].getAttribute('data-sb-height');
            }
        });

        return wrap;
    }

    // ---- Export -----------------------------------------------------------

    var ScoreBadge = {
        render: render,
        renderMini: renderMini,
        renderDistributionChart: renderDistributionChart,
        scoreColor: scoreColor,
        overall: overall
    };

    root.ScoreBadge = ScoreBadge;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ScoreBadge;
    }

})(typeof window !== 'undefined' ? window : this);
