/**
 * SkeletonLoader - Animated placeholder UI for loading states.
 *
 * Usage:
 *   var loader = new SkeletonLoader(containerEl, { type: 'cards' });
 *   loader.show();
 *   // ... fetch data ...
 *   loader.hide();            // smooth fade out
 *   loader.showError(err);    // error state with retry button
 *
 * Auto-init: any element with data-skeleton="true" gets a skeleton
 * injected on DOMContentLoaded. Set data-skeleton-type to one of:
 *   cards | feed | chart | table | text | image
 */
(function (root) {
    'use strict';

    // ----------------------------------------------------------------
    // CSS (injected once)
    // ----------------------------------------------------------------
    var STYLE_ID = 'skeleton-loader-styles';

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = [
            /* pulse animation */
            '@keyframes skeletonPulse{0%,100%{opacity:.35}50%{opacity:.7}}',

            /* base bar */
            '.sk-bar{border-radius:6px;background:var(--border,#1E2330);animation:skeletonPulse 1.6s ease-in-out infinite}',

            /* circle variant */
            '.sk-circle{border-radius:50%;background:var(--border,#1E2330);animation:skeletonPulse 1.6s ease-in-out infinite}',

            /* wrapper holds skeletons & real content */
            '.sk-wrapper{position:relative}',
            '.sk-overlay{position:absolute;inset:0;z-index:5;transition:opacity .35s ease}',
            '.sk-overlay--hidden{opacity:0;pointer-events:none}',

            /* fade in real content */
            '.sk-content{opacity:0;transition:opacity .35s ease}',
            '.sk-content--visible{opacity:1}',

            /* card skeleton */
            '.sk-card{padding:40px 32px 36px;text-align:center}',
            '.sk-card .sk-circle{width:60px;height:60px;margin:0 auto 20px}',
            '.sk-card .sk-bar--big{width:80px;height:48px;margin:0 auto 12px}',
            '.sk-card .sk-bar--label{width:120px;height:12px;margin:0 auto}',

            /* feed skeleton */
            '.sk-feed-item{display:flex;gap:14px;padding:16px 28px;border-bottom:1px solid rgba(255,255,255,.03)}',
            '.sk-feed-item .sk-circle{width:10px;height:10px;margin-top:5px;flex-shrink:0}',
            '.sk-feed-item .sk-bar--text{height:14px;margin-bottom:6px}',
            '.sk-feed-item .sk-bar--time{width:60px;height:10px}',

            /* chart skeleton */
            '.sk-chart{display:flex;flex-direction:column;align-items:center;padding:24px}',
            '.sk-chart .sk-circle--ring{width:160px;height:160px;margin-bottom:16px}',
            '.sk-chart .sk-bar--legend{height:12px;margin-bottom:8px}',

            /* table skeleton */
            '.sk-table-row{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.03)}',
            '.sk-table-row .sk-bar{height:14px}',

            /* text skeleton */
            '.sk-text .sk-bar{height:14px;margin-bottom:10px}',

            /* image skeleton */
            '.sk-image{border-radius:12px;background:var(--border,#1E2330);animation:skeletonPulse 1.6s ease-in-out infinite}',

            /* error state */
            '.sk-error{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;text-align:center;color:var(--text-dim,#6B7385)}',
            '.sk-error-icon{font-size:28px;color:var(--red,#D71920);font-weight:700}',
            '.sk-error-msg{font-size:14px;max-width:300px}',
            '.sk-error-retry{padding:8px 24px;border:1px solid var(--red,#D71920);border-radius:8px;background:transparent;color:var(--red,#D71920);font-size:13px;font-weight:600;cursor:pointer;transition:background .2s,color .2s}',
            '.sk-error-retry:hover{background:var(--red,#D71920);color:#fff}'
        ].join('\n');
        document.head.appendChild(s);
    }

    // ----------------------------------------------------------------
    // Skeleton generators per type
    // ----------------------------------------------------------------
    var generators = {
        cards: function (count) {
            count = count || 3;
            var html = '';
            for (var i = 0; i < count; i++) {
                html += '<div class="sk-card">'
                    + '<div class="sk-circle"></div>'
                    + '<div class="sk-bar sk-bar--big"></div>'
                    + '<div class="sk-bar sk-bar--label"></div>'
                    + '</div>';
            }
            return html;
        },

        feed: function (count) {
            count = count || 5;
            var html = '';
            for (var i = 0; i < count; i++) {
                var w = 60 + Math.floor(Math.random() * 30);
                html += '<div class="sk-feed-item">'
                    + '<div class="sk-circle"></div>'
                    + '<div style="flex:1">'
                    + '<div class="sk-bar sk-bar--text" style="width:' + w + '%"></div>'
                    + '<div class="sk-bar sk-bar--time"></div>'
                    + '</div></div>';
            }
            return html;
        },

        chart: function () {
            return '<div class="sk-chart">'
                + '<div class="sk-circle sk-circle--ring"></div>'
                + '<div class="sk-bar sk-bar--legend" style="width:80%"></div>'
                + '<div class="sk-bar sk-bar--legend" style="width:70%"></div>'
                + '<div class="sk-bar sk-bar--legend" style="width:60%"></div>'
                + '</div>';
        },

        table: function (rows, cols) {
            rows = rows || 5;
            cols = cols || 4;
            var html = '';
            for (var r = 0; r < rows; r++) {
                html += '<div class="sk-table-row">';
                for (var c = 0; c < cols; c++) {
                    var w = 15 + Math.floor(Math.random() * 25);
                    html += '<div class="sk-bar" style="width:' + w + '%;flex:' + (c === 0 ? 2 : 1) + '"></div>';
                }
                html += '</div>';
            }
            return html;
        },

        text: function (lines) {
            lines = lines || 4;
            var html = '<div class="sk-text">';
            for (var i = 0; i < lines; i++) {
                var w = i === lines - 1 ? 40 + Math.floor(Math.random() * 20) : 80 + Math.floor(Math.random() * 20);
                html += '<div class="sk-bar" style="width:' + w + '%"></div>';
            }
            return html + '</div>';
        },

        image: function () {
            return '<div class="sk-image" style="width:100%;height:200px"></div>';
        },

        products: function (count) {
            count = count || 5;
            var html = '';
            for (var i = 0; i < count; i++) {
                html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'
                    + '<div class="sk-bar" style="width:24px;height:24px;border-radius:6px;flex-shrink:0"></div>'
                    + '<div style="flex:1">'
                    + '<div class="sk-bar" style="width:' + (50 + Math.floor(Math.random() * 30)) + '%;height:13px;margin-bottom:6px"></div>'
                    + '<div class="sk-bar" style="width:100%;height:4px"></div>'
                    + '</div>'
                    + '<div class="sk-bar" style="width:24px;height:12px;flex-shrink:0"></div>'
                    + '</div>';
            }
            return html;
        }
    };

    // ----------------------------------------------------------------
    // SkeletonLoader class
    // ----------------------------------------------------------------
    function SkeletonLoader(container, opts) {
        if (typeof container === 'string') {
            container = document.querySelector(container);
        }
        if (!container) throw new Error('SkeletonLoader: container not found');

        this.container = container;
        this.opts = opts || {};
        this.type = this.opts.type || container.getAttribute('data-skeleton-type') || 'text';
        this._overlay = null;
        this._onRetry = this.opts.onRetry || null;
        this._visible = false;

        injectStyles();
    }

    SkeletonLoader.prototype.show = function () {
        if (this._visible) return this;
        this._visible = true;

        // Wrap existing content if needed
        if (!this.container.classList.contains('sk-wrapper')) {
            this.container.classList.add('sk-wrapper');
        }

        // Mark real content as hidden
        var children = this.container.children;
        for (var i = 0; i < children.length; i++) {
            if (!children[i].classList.contains('sk-overlay')) {
                children[i].classList.add('sk-content');
                children[i].classList.remove('sk-content--visible');
            }
        }

        // Create overlay
        var overlay = document.createElement('div');
        overlay.className = 'sk-overlay';
        var gen = generators[this.type];
        overlay.innerHTML = gen ? gen(this.opts.count, this.opts.cols) : generators.text();

        // Match parent layout for card grids
        if (this.type === 'cards' && this.container.style.display !== 'flex') {
            overlay.style.display = 'grid';
            var cs = window.getComputedStyle(this.container);
            overlay.style.gridTemplateColumns = cs.gridTemplateColumns;
            overlay.style.gap = cs.gap;
        }

        this.container.appendChild(overlay);
        this._overlay = overlay;
        return this;
    };

    SkeletonLoader.prototype.hide = function () {
        if (!this._visible) return this;
        var self = this;

        // Fade out overlay
        if (this._overlay) {
            this._overlay.classList.add('sk-overlay--hidden');
            setTimeout(function () {
                if (self._overlay && self._overlay.parentNode) {
                    self._overlay.parentNode.removeChild(self._overlay);
                }
                self._overlay = null;
            }, 350);
        }

        // Fade in real content
        var children = this.container.children;
        for (var i = 0; i < children.length; i++) {
            if (children[i].classList.contains('sk-content')) {
                children[i].classList.add('sk-content--visible');
            }
        }

        this._visible = false;
        return this;
    };

    SkeletonLoader.prototype.showError = function (message) {
        var self = this;
        this.hide();

        // Remove existing error
        var existing = this.container.querySelector('.sk-error');
        if (existing) existing.parentNode.removeChild(existing);

        var errDiv = document.createElement('div');
        errDiv.className = 'sk-error';
        errDiv.innerHTML = '<div class="sk-error-icon">!</div>'
            + '<div class="sk-error-msg">' + (message || 'Failed to load data') + '</div>'
            + '<button class="sk-error-retry">Retry</button>';

        errDiv.querySelector('.sk-error-retry').addEventListener('click', function () {
            errDiv.parentNode.removeChild(errDiv);
            if (self._onRetry) {
                self.show();
                self._onRetry();
            }
        });

        this.container.appendChild(errDiv);
        return this;
    };

    SkeletonLoader.prototype.clearError = function () {
        var err = this.container.querySelector('.sk-error');
        if (err) err.parentNode.removeChild(err);
        return this;
    };

    // ----------------------------------------------------------------
    // Auto-init: scan for data-skeleton="true"
    // ----------------------------------------------------------------
    function autoInit() {
        var els = document.querySelectorAll('[data-skeleton="true"]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (el._skeletonLoader) continue;
            var loader = new SkeletonLoader(el);
            el._skeletonLoader = loader;
            loader.show();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }

    // ----------------------------------------------------------------
    // Export
    // ----------------------------------------------------------------
    root.SkeletonLoader = SkeletonLoader;

})(typeof window !== 'undefined' ? window : this);
