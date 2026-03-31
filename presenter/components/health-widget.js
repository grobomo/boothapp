/**
 * BoothApp Health Widget
 *
 * Self-contained health status widget. Drop a <script> tag in any page:
 *   <script src="components/health-widget.js"></script>
 *
 * Configure via window.HEALTH_WIDGET before loading:
 *   window.HEALTH_WIDGET = { apiUrl: 'http://localhost:3000', sound: true };
 *
 * If no apiUrl is set, the widget runs in demo mode with simulated status.
 */
(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────
    var cfg = window.HEALTH_WIDGET || {};
    var API_URL       = cfg.apiUrl || '';
    var REFRESH_MS    = cfg.refreshMs || 10000;
    var SOUND_ENABLED = cfg.sound !== undefined ? cfg.sound : false;

    // ── State ───────────────────────────────────────────────────────
    var state = {
        overall:       'green',   // green | yellow | red
        s3:            { status: 'ok', detail: '' },
        watcher:       { status: 'ok', detail: '' },
        lambda:        { status: 'ok', detail: '' },
        lastSession:   null,      // ISO timestamp
        errorCount:    0,
        expanded:      false,
        minimized:     false,
        prevOverall:   null
    };

    // ── Sound (optional) ────────────────────────────────────────────
    var audioCtx = null;
    function playTone(freq, duration) {
        if (!SOUND_ENABLED) return;
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            var osc = audioCtx.createOscillator();
            var gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.value = 0.08;
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
            osc.stop(audioCtx.currentTime + duration);
        } catch (e) { /* silent fail */ }
    }

    function notifyStatusChange(newStatus) {
        if (state.prevOverall === null) { state.prevOverall = newStatus; return; }
        if (newStatus === state.prevOverall) return;
        state.prevOverall = newStatus;
        if (newStatus === 'red')    playTone(220, 0.4);
        if (newStatus === 'yellow') playTone(440, 0.25);
        if (newStatus === 'green')  playTone(880, 0.15);
    }

    // ── Inject CSS ──────────────────────────────────────────────────
    var style = document.createElement('style');
    style.textContent = [
        '#hw-root{position:fixed;bottom:16px;left:16px;z-index:99999;font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;color:#F0F2F5;user-select:none}',
        '#hw-dot{width:14px;height:14px;border-radius:50%;cursor:pointer;transition:box-shadow .3s,background .3s;border:2px solid rgba(255,255,255,.15)}',
        '#hw-dot.green{background:#00E676;box-shadow:0 0 8px rgba(0,230,118,.6)}',
        '#hw-dot.yellow{background:#FFAB00;box-shadow:0 0 8px rgba(255,171,0,.6)}',
        '#hw-dot.red{background:#D71920;box-shadow:0 0 8px rgba(215,25,32,.6)}',
        '#hw-dot.pulse{animation:hw-pulse 1.4s ease-in-out infinite}',
        '@keyframes hw-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.3)}}',
        '#hw-panel{position:absolute;bottom:24px;left:0;width:280px;background:#0E1118;border:1px solid #1E2330;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;opacity:0;transform:translateY(8px) scale(.95);pointer-events:none;transition:opacity .2s,transform .2s}',
        '#hw-panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}',
        '#hw-panel-header{padding:10px 14px;border-bottom:1px solid #1E2330;display:flex;align-items:center;justify-content:space-between}',
        '#hw-panel-header span{font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#8A92A0}',
        '#hw-minimize{background:none;border:none;color:#8A92A0;cursor:pointer;font-size:16px;line-height:1;padding:0 4px}',
        '#hw-minimize:hover{color:#F0F2F5}',
        '.hw-row{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.03)}',
        '.hw-row:last-child{border-bottom:none}',
        '.hw-label{color:#6B7385;font-size:12px}',
        '.hw-val{font-size:12px;font-weight:600}',
        '.hw-val.ok{color:#00E676}',
        '.hw-val.degraded{color:#FFAB00}',
        '.hw-val.down{color:#D71920}',
        '.hw-val.neutral{color:#8A92A0}',
        '#hw-refresh-bar{height:2px;background:#1E2330;overflow:hidden}',
        '#hw-refresh-fill{height:100%;background:#D71920;transition:width .3s linear;width:100%}'
    ].join('\n');
    document.head.appendChild(style);

    // ── Build DOM ───────────────────────────────────────────────────
    var root = document.createElement('div');
    root.id = 'hw-root';
    root.innerHTML = [
        '<div id="hw-dot" class="green" title="System Health"></div>',
        '<div id="hw-panel">',
        '  <div id="hw-panel-header"><span>System Health</span><button id="hw-minimize" title="Minimize">&#x2212;</button></div>',
        '  <div id="hw-refresh-bar"><div id="hw-refresh-fill"></div></div>',
        '  <div class="hw-row"><span class="hw-label">S3 Storage</span><span class="hw-val" id="hw-s3">--</span></div>',
        '  <div class="hw-row"><span class="hw-label">Watcher</span><span class="hw-val" id="hw-watcher">--</span></div>',
        '  <div class="hw-row"><span class="hw-label">Lambda</span><span class="hw-val" id="hw-lambda">--</span></div>',
        '  <div class="hw-row"><span class="hw-label">Last Session</span><span class="hw-val neutral" id="hw-last">--</span></div>',
        '  <div class="hw-row"><span class="hw-label">Errors</span><span class="hw-val neutral" id="hw-errors">0</span></div>',
        '</div>'
    ].join('');

    function mount() {
        document.body.appendChild(root);
        bindEvents();
        refresh();
        setInterval(refresh, REFRESH_MS);
        startRefreshBar();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

    // ── Events ──────────────────────────────────────────────────────
    function bindEvents() {
        var dot = document.getElementById('hw-dot');
        var panel = document.getElementById('hw-panel');
        var minBtn = document.getElementById('hw-minimize');

        dot.addEventListener('click', function (e) {
            e.stopPropagation();
            if (state.minimized) {
                state.minimized = false;
            }
            state.expanded = !state.expanded;
            panel.classList.toggle('open', state.expanded);
        });

        minBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            state.expanded = false;
            state.minimized = true;
            panel.classList.remove('open');
        });

        document.addEventListener('click', function () {
            if (state.expanded) {
                state.expanded = false;
                panel.classList.remove('open');
            }
        });

        panel.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    // ── Refresh bar animation ───────────────────────────────────────
    var barStart = Date.now();
    function startRefreshBar() {
        barStart = Date.now();
        requestAnimationFrame(tickBar);
    }
    function tickBar() {
        var elapsed = Date.now() - barStart;
        var pct = Math.max(0, 100 - (elapsed / REFRESH_MS) * 100);
        var fill = document.getElementById('hw-refresh-fill');
        if (fill) fill.style.width = pct + '%';
        if (elapsed < REFRESH_MS) requestAnimationFrame(tickBar);
    }

    // ── Data fetch ──────────────────────────────────────────────────
    function refresh() {
        barStart = Date.now();
        requestAnimationFrame(tickBar);

        if (!API_URL) {
            refreshMock();
            render();
            return;
        }

        // Try aggregated health endpoint first, fall back to individual checks
        fetch(API_URL + '/api/health')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                applyApiData(data);
                render();
            })
            .catch(function () {
                // Fall back to individual endpoint checks
                fetchIndividualHealth();
            });
    }

    function applyApiData(data) {
        if (data.s3)      state.s3      = { status: data.s3.status || 'ok', detail: data.s3.detail || '' };
        if (data.watcher)  state.watcher  = { status: data.watcher.status || 'ok', detail: data.watcher.detail || '' };
        if (data.lambda)   state.lambda   = { status: data.lambda.status || 'ok', detail: data.lambda.detail || '' };
        if (data.lastSessionTime) state.lastSession = data.lastSessionTime;
        if (data.errorCount !== undefined) state.errorCount = data.errorCount;
        computeOverall();
    }

    function fetchIndividualHealth() {
        var results = { s3: null, watcher: null };
        var done = 0;
        var total = 2;

        function check() {
            done++;
            if (done < total) return;
            if (results.watcher) {
                var ok = results.watcher.status === 'ok';
                state.watcher = { status: ok ? 'ok' : 'down', detail: ok ? 'Running' : results.watcher.error || 'Unreachable' };
            } else {
                state.watcher = { status: 'down', detail: 'Unreachable' };
            }
            state.s3 = results.s3
                ? { status: 'ok', detail: results.s3.totalSizeMB + ' MB' }
                : { status: 'down', detail: 'Unreachable' };
            computeOverall();
            render();
        }

        fetch(API_URL + '/api/watcher/status')
            .then(function (r) { return r.json(); })
            .then(function (d) { results.watcher = d; check(); })
            .catch(function () { check(); });

        fetch(API_URL + '/api/storage/stats')
            .then(function (r) { return r.json(); })
            .then(function (d) { results.s3 = d; check(); })
            .catch(function () { check(); });
    }

    // ── Mock mode (demo without backend) ────────────────────────────
    function refreshMock() {
        // Simulate realistic health that occasionally degrades
        var rand = Math.random();
        state.s3      = rand > 0.05 ? { status: 'ok', detail: '42.3 MB' }      : { status: 'degraded', detail: 'Slow response' };
        state.watcher  = rand > 0.08 ? { status: 'ok', detail: 'Running 2h 14m' } : { status: 'down', detail: 'Unreachable' };
        state.lambda   = rand > 0.06 ? { status: 'ok', detail: '~120ms avg' }     : { status: 'degraded', detail: 'Cold starts' };
        state.lastSession = new Date(Date.now() - Math.floor(Math.random() * 300000)).toISOString();
        state.errorCount = Math.floor(Math.random() * 3);
        computeOverall();
    }

    function computeOverall() {
        var statuses = [state.s3.status, state.watcher.status, state.lambda.status];
        if (statuses.indexOf('down') !== -1)          state.overall = 'red';
        else if (statuses.indexOf('degraded') !== -1)  state.overall = 'yellow';
        else                                           state.overall = 'green';
        notifyStatusChange(state.overall);
    }

    // ── Render ──────────────────────────────────────────────────────
    function render() {
        var dot = document.getElementById('hw-dot');
        dot.className = state.overall;
        dot.classList.toggle('pulse', state.overall === 'red');

        setStatus('hw-s3',      state.s3);
        setStatus('hw-watcher',  state.watcher);
        setStatus('hw-lambda',   state.lambda);

        var lastEl = document.getElementById('hw-last');
        lastEl.textContent = state.lastSession ? timeAgo(state.lastSession) : '--';

        var errEl = document.getElementById('hw-errors');
        errEl.textContent = state.errorCount;
        errEl.className = 'hw-val ' + (state.errorCount > 0 ? 'down' : 'neutral');
    }

    function setStatus(id, svc) {
        var el = document.getElementById(id);
        var label = svc.status === 'ok' ? 'OK' : svc.status === 'degraded' ? 'Degraded' : 'Down';
        el.textContent = label + (svc.detail ? ' - ' + svc.detail : '');
        el.className = 'hw-val ' + svc.status;
    }

    function timeAgo(iso) {
        var diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (diff < 5)    return 'just now';
        if (diff < 60)   return diff + 's ago';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        return Math.floor(diff / 3600) + 'h ago';
    }

})();
