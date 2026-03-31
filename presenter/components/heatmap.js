/**
 * BoothApp Click Heatmap
 *
 * Renders a click-density heatmap on an HTML5 Canvas overlaid on a screenshot.
 * Input: array of click objects {x, y, timestamp, url, element} plus a screenshot image.
 * Uses gaussian radial gradient for smooth heat blending and a blue-to-red color ramp.
 *
 * Usage:
 *   var hm = new BoothHeatmap(containerEl, { width: 1280, height: 720 });
 *   hm.setScreenshot('screenshots/click-001.jpg');
 *   hm.setClicks(clicksArray);
 *   hm.render();
 *   hm.toggle();           // show/hide overlay
 *   hm.setMode('aggregate'); // 'single' | 'aggregate'
 */
(function (root) {
    'use strict';

    // ------------------------------------------------------------------ config
    var DEFAULTS = {
        width: 1280,
        height: 720,
        radius: 40,          // base gaussian radius in px
        blur: 15,            // extra blur pass
        opacity: 0.6,        // overlay alpha
        gradientStops: [
            { stop: 0.0, color: [0, 0, 255] },    // blue   - cold
            { stop: 0.25, color: [0, 255, 255] },  // cyan
            { stop: 0.5, color: [0, 255, 0] },     // green
            { stop: 0.75, color: [255, 255, 0] },  // yellow
            { stop: 1.0, color: [255, 0, 0] }      // red    - hot
        ]
    };

    // ------------------------------------------------------------ constructor
    function BoothHeatmap(container, opts) {
        opts = opts || {};
        this.width = opts.width || DEFAULTS.width;
        this.height = opts.height || DEFAULTS.height;
        this.radius = opts.radius || DEFAULTS.radius;
        this.blur = opts.blur || DEFAULTS.blur;
        this.opacity = opts.opacity || DEFAULTS.opacity;
        this.gradientStops = opts.gradientStops || DEFAULTS.gradientStops;

        this.container = typeof container === 'string'
            ? document.querySelector(container) : container;

        this._clicks = [];
        this._allSessions = [];   // for aggregate mode
        this._mode = 'single';    // 'single' | 'aggregate'
        this._visible = true;
        this._screenshotSrc = null;
        this._screenshotImg = null;

        this._buildDOM();
        this._buildPalette();
    }

    // -------------------------------------------------------- DOM scaffolding
    BoothHeatmap.prototype._buildDOM = function () {
        this.container.style.position = 'relative';
        this.container.style.display = 'inline-block';

        // Screenshot layer
        this._imgCanvas = _makeCanvas(this.width, this.height, '1');
        this.container.appendChild(this._imgCanvas);

        // Heat layer (on top)
        this._heatCanvas = _makeCanvas(this.width, this.height, '2');
        this._heatCanvas.style.position = 'absolute';
        this._heatCanvas.style.left = '0';
        this._heatCanvas.style.top = '0';
        this.container.appendChild(this._heatCanvas);

        // Legend
        this._legendEl = document.createElement('div');
        this._legendEl.className = 'heatmap-legend';
        this._legendEl.style.cssText =
            'position:absolute;bottom:12px;right:12px;z-index:3;' +
            'background:rgba(0,0,0,.75);border-radius:6px;padding:8px 12px;' +
            'font:12px/1.4 "Segoe UI",sans-serif;color:#f0f2f5;min-width:110px;';
        this.container.appendChild(this._legendEl);
    };

    function _makeCanvas(w, h, z) {
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.style.display = 'block';
        c.style.zIndex = z;
        return c;
    }

    // --------------------------------------------------- color palette (256)
    BoothHeatmap.prototype._buildPalette = function () {
        this._palette = new Uint8Array(256 * 4);
        var stops = this.gradientStops;
        for (var i = 0; i < 256; i++) {
            var t = i / 255;
            var lo = stops[0], hi = stops[stops.length - 1];
            for (var s = 1; s < stops.length; s++) {
                if (t <= stops[s].stop) { lo = stops[s - 1]; hi = stops[s]; break; }
            }
            var range = hi.stop - lo.stop || 1;
            var pct = (t - lo.stop) / range;
            this._palette[i * 4]     = lo.color[0] + (hi.color[0] - lo.color[0]) * pct | 0;
            this._palette[i * 4 + 1] = lo.color[1] + (hi.color[1] - lo.color[1]) * pct | 0;
            this._palette[i * 4 + 2] = lo.color[2] + (hi.color[2] - lo.color[2]) * pct | 0;
            this._palette[i * 4 + 3] = 255;
        }
    };

    // --------------------------------------------------------- public API
    BoothHeatmap.prototype.setScreenshot = function (src, cb) {
        var self = this;
        self._screenshotSrc = src;
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            self._screenshotImg = img;
            self._drawScreenshot();
            if (cb) cb();
        };
        img.onerror = function () {
            self._screenshotImg = null;
            self._drawScreenshot();
            if (cb) cb(new Error('Failed to load screenshot: ' + src));
        };
        img.src = src;
    };

    BoothHeatmap.prototype.setClicks = function (clicks) {
        this._clicks = clicks || [];
    };

    BoothHeatmap.prototype.addSession = function (sessionClicks) {
        this._allSessions.push(sessionClicks || []);
    };

    BoothHeatmap.prototype.clearSessions = function () {
        this._allSessions = [];
    };

    BoothHeatmap.prototype.setMode = function (mode) {
        this._mode = mode === 'aggregate' ? 'aggregate' : 'single';
    };

    BoothHeatmap.prototype.toggle = function (forceState) {
        if (typeof forceState === 'boolean') {
            this._visible = forceState;
        } else {
            this._visible = !this._visible;
        }
        this._heatCanvas.style.display = this._visible ? 'block' : 'none';
        this._legendEl.style.display = this._visible ? 'block' : 'none';
    };

    BoothHeatmap.prototype.isVisible = function () {
        return this._visible;
    };

    BoothHeatmap.prototype.resize = function (w, h) {
        this.width = w;
        this.height = h;
        this._imgCanvas.width = w; this._imgCanvas.height = h;
        this._heatCanvas.width = w; this._heatCanvas.height = h;
        this._drawScreenshot();
        this.render();
    };

    // ----------------------------------------------------------- rendering
    BoothHeatmap.prototype.render = function () {
        var clicks = this._mode === 'aggregate' ? this._aggregateClicks() : this._clicks;
        this._renderHeat(clicks);
        this._renderLegend(clicks);
    };

    BoothHeatmap.prototype._aggregateClicks = function () {
        var all = [];
        for (var i = 0; i < this._allSessions.length; i++) {
            var sess = this._allSessions[i];
            for (var j = 0; j < sess.length; j++) {
                all.push(sess[j]);
            }
        }
        return all;
    };

    BoothHeatmap.prototype._drawScreenshot = function () {
        var ctx = this._imgCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.width, this.height);
        if (this._screenshotImg) {
            ctx.drawImage(this._screenshotImg, 0, 0, this.width, this.height);
        } else {
            // placeholder grid
            ctx.fillStyle = '#0E1118';
            ctx.fillRect(0, 0, this.width, this.height);
            ctx.strokeStyle = '#1E2330';
            for (var x = 0; x < this.width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke(); }
            for (var y = 0; y < this.height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke(); }
            ctx.fillStyle = '#6B7385';
            ctx.font = '16px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No screenshot loaded', this.width / 2, this.height / 2);
        }
    };

    BoothHeatmap.prototype._renderHeat = function (clicks) {
        var w = this.width, h = this.height;
        var ctx = this._heatCanvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        if (!clicks.length) {
            this._renderLegend([]);
            return;
        }

        // Pass 1: draw alpha circles (intensity map in grayscale)
        var alphaCanvas = document.createElement('canvas');
        alphaCanvas.width = w;
        alphaCanvas.height = h;
        var actx = alphaCanvas.getContext('2d');

        // Build density grid for adaptive intensity
        var maxDensity = this._computeMaxDensity(clicks);

        for (var i = 0; i < clicks.length; i++) {
            var cx = clicks[i].x, cy = clicks[i].y;
            if (cx === undefined || cy === undefined) continue;

            var grad = actx.createRadialGradient(cx, cy, 0, cx, cy, this.radius);
            var alpha = Math.min(1, 1 / maxDensity + 0.05);
            grad.addColorStop(0, 'rgba(0,0,0,' + alpha + ')');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            actx.fillStyle = grad;
            actx.fillRect(cx - this.radius, cy - this.radius, this.radius * 2, this.radius * 2);
        }

        // Pass 2: colorize the alpha map
        var imgData = actx.getImageData(0, 0, w, h);
        var pixels = imgData.data;
        var pal = this._palette;

        for (var p = 0; p < pixels.length; p += 4) {
            var a = pixels[p + 3];  // alpha channel = intensity
            if (a === 0) continue;
            var idx = a * 4;
            pixels[p]     = pal[idx];
            pixels[p + 1] = pal[idx + 1];
            pixels[p + 2] = pal[idx + 2];
            pixels[p + 3] = a;
        }
        actx.putImageData(imgData, 0, 0);

        // Pass 3: composite onto heat canvas with opacity
        ctx.globalAlpha = this.opacity;
        ctx.filter = 'blur(' + this.blur + 'px)';
        ctx.drawImage(alphaCanvas, 0, 0);
        ctx.filter = 'none';
        ctx.globalAlpha = 1.0;
    };

    BoothHeatmap.prototype._computeMaxDensity = function (clicks) {
        // Simple grid-based density to normalize intensity
        var cellSize = this.radius;
        var cols = Math.ceil(this.width / cellSize);
        var grid = {};
        var max = 1;
        for (var i = 0; i < clicks.length; i++) {
            var c = clicks[i];
            if (c.x === undefined || c.y === undefined) continue;
            var key = Math.floor(c.x / cellSize) + ',' + Math.floor(c.y / cellSize);
            grid[key] = (grid[key] || 0) + 1;
            if (grid[key] > max) max = grid[key];
        }
        return max;
    };

    // ------------------------------------------------------------- legend
    BoothHeatmap.prototype._renderLegend = function (clicks) {
        var el = this._legendEl;
        var count = clicks.length;
        var maxD = count > 0 ? this._computeMaxDensity(clicks) : 0;

        // Gradient bar
        var barHTML =
            '<div style="font-weight:600;margin-bottom:6px">Click Density</div>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
            '  <span style="font-size:11px">Low</span>' +
            '  <div style="flex:1;height:12px;border-radius:3px;' +
            '    background:linear-gradient(to right,#0000ff,#00ffff,#00ff00,#ffff00,#ff0000)"></div>' +
            '  <span style="font-size:11px">High</span>' +
            '</div>' +
            '<div style="margin-top:6px;font-size:11px;color:#6B7385">' +
            '  Total clicks: ' + count +
            (maxD > 0 ? '<br>Peak density: ' + maxD + ' clicks/cell' : '') +
            '</div>';

        el.innerHTML = barHTML;
    };

    // ------------------------------------------------------------ export
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = BoothHeatmap;
    } else {
        root.BoothHeatmap = BoothHeatmap;
    }

})(typeof window !== 'undefined' ? window : this);
