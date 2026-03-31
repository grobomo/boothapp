/**
 * BoothApp Session Timeline
 *
 * Vertical timeline visualization for session events (clicks + transcript).
 * Click events render on the left with screenshot thumbnails.
 * Transcript events render on the right with speaker labels.
 * Color-coded: blue = clicks, green = SE speech, purple = visitor speech.
 * Timestamps on the center line. Click any card to expand details.
 * Product badges show which V1 module was active.
 *
 * Usage:
 *   var tl = new BoothTimeline(containerEl, { width: 800 });
 *   tl.setEvents(eventsArray);
 *   tl.render();
 *
 * Event shape:
 *   { type: 'click'|'transcript', timestamp: Number,
 *     // click-specific:
 *     x: Number, y: Number, element: String, url: String, screenshot: String,
 *     // transcript-specific:
 *     speaker: 'se'|'visitor', text: String,
 *     // optional:
 *     product: String }
 */
(function (root) {
    'use strict';

    // ---------------------------------------------------------------- config
    var COLORS = {
        click:   '#448AFF',
        se:      '#00E676',
        visitor: '#B388FF'
    };

    var PRODUCT_MAP = {
        'vision-one':        'Vision One XDR',
        'xdr':               'Vision One XDR',
        'cloud-security':    'Cloud Security',
        'cloud-one':         'Cloud Security',
        'zero-trust':        'Zero Trust',
        'ztsa':              'Zero Trust',
        'endpoint':          'Endpoint Security',
        'epp':               'Endpoint Security',
        'email-security':    'Email Security',
        'email':             'Email Security',
        'network-defense':   'Network Defense',
        'network':           'Network Defense',
        'tippingpoint':      'Network Defense',
        'workload':          'Workload Security',
        'container':         'Container Security'
    };

    // ---------------------------------------------------------- constructor
    function BoothTimeline(container, opts) {
        opts = opts || {};
        this.container = typeof container === 'string'
            ? document.querySelector(container) : container;
        this.width = opts.width || 800;
        this._events = [];
        this._expandedIdx = -1;
        this._el = null;
    }

    // ---------------------------------------------------------- public API
    BoothTimeline.prototype.setEvents = function (events) {
        this._events = (events || []).slice().sort(function (a, b) {
            return a.timestamp - b.timestamp;
        });
        this._expandedIdx = -1;
    };

    BoothTimeline.prototype.render = function () {
        if (!this.container) return;
        if (this._el) this.container.removeChild(this._el);

        var wrap = document.createElement('div');
        wrap.className = 'booth-timeline';
        wrap.style.cssText = 'position:relative;width:' + this.width + 'px;margin:0 auto;padding:24px 0;';

        // Center line
        var line = document.createElement('div');
        line.className = 'booth-timeline__line';
        line.style.cssText =
            'position:absolute;left:50%;top:0;bottom:0;width:2px;' +
            'background:linear-gradient(to bottom,transparent,#1E2330 5%,#1E2330 95%,transparent);' +
            'transform:translateX(-1px);';
        wrap.appendChild(line);

        if (!this._events.length) {
            var empty = document.createElement('div');
            empty.style.cssText = 'text-align:center;padding:60px 0;color:#6B7385;font-size:14px;';
            empty.textContent = 'No events to display';
            wrap.appendChild(empty);
            this.container.appendChild(wrap);
            this._el = wrap;
            return;
        }

        var baseTs = this._events[0].timestamp;
        for (var i = 0; i < this._events.length; i++) {
            wrap.appendChild(this._buildCard(this._events[i], i, baseTs));
        }

        this.container.appendChild(wrap);
        this._el = wrap;
    };

    BoothTimeline.prototype.destroy = function () {
        if (this._el && this._el.parentNode) {
            this._el.parentNode.removeChild(this._el);
        }
        this._el = null;
    };

    // --------------------------------------------------------- card builder
    BoothTimeline.prototype._buildCard = function (evt, idx, baseTs) {
        var self = this;
        var isClick = evt.type === 'click';
        var isLeft = isClick; // clicks left, transcript right
        var color = isClick ? COLORS.click
            : (evt.speaker === 'se' ? COLORS.se : COLORS.visitor);
        var elapsed = ((evt.timestamp - baseTs) / 1000).toFixed(1);

        var row = document.createElement('div');
        row.className = 'booth-timeline__row';
        row.style.cssText =
            'position:relative;display:flex;align-items:flex-start;' +
            'margin-bottom:8px;min-height:60px;';

        // ---- timestamp dot on center line
        var dot = document.createElement('div');
        dot.className = 'booth-timeline__dot';
        dot.style.cssText =
            'position:absolute;left:50%;top:16px;width:12px;height:12px;' +
            'border-radius:50%;transform:translate(-50%,0);z-index:2;' +
            'background:' + color + ';' +
            'box-shadow:0 0 8px ' + color + '80;';
        row.appendChild(dot);

        // ---- timestamp label
        var tsLabel = document.createElement('div');
        tsLabel.className = 'booth-timeline__ts';
        tsLabel.style.cssText =
            'position:absolute;left:50%;top:32px;transform:translateX(-50%);' +
            'font-size:10px;color:#6B7385;white-space:nowrap;z-index:2;';
        tsLabel.textContent = elapsed + 's';
        row.appendChild(tsLabel);

        // ---- card
        var card = document.createElement('div');
        card.className = 'booth-timeline__card';
        var side = isLeft ? 'right' : 'left';
        var cardWidth = Math.floor(this.width / 2 - 40);
        card.style.cssText =
            'width:' + cardWidth + 'px;' +
            'margin-' + (isLeft ? 'right' : 'left') + ':auto;' +
            'margin-' + side + ':' + (Math.floor(this.width / 2) + 20) + 'px;' +
            'background:#0E1118;border:1px solid #1E2330;border-radius:8px;' +
            'padding:10px 14px;cursor:pointer;transition:border-color .15s,box-shadow .15s;' +
            'border-left:3px solid ' + color + ';';

        // Position: left cards get margin-right to push left, right cards margin-left
        if (isLeft) {
            card.style.cssText =
                'width:' + cardWidth + 'px;' +
                'margin-right:' + (Math.floor(this.width / 2) + 20) + 'px;' +
                'margin-left:0;' +
                'background:#0E1118;border:1px solid #1E2330;border-radius:8px;' +
                'padding:10px 14px;cursor:pointer;transition:border-color .15s,box-shadow .15s;' +
                'border-left:3px solid ' + color + ';';
        } else {
            card.style.cssText =
                'width:' + cardWidth + 'px;' +
                'margin-left:' + (Math.floor(this.width / 2) + 20) + 'px;' +
                'margin-right:0;' +
                'background:#0E1118;border:1px solid #1E2330;border-radius:8px;' +
                'padding:10px 14px;cursor:pointer;transition:border-color .15s,box-shadow .15s;' +
                'border-left:3px solid ' + color + ';';
        }

        card.onmouseenter = function () { card.style.borderColor = color; card.style.boxShadow = '0 0 12px ' + color + '30'; };
        card.onmouseleave = function () {
            card.style.borderColor = '#1E2330';
            card.style.borderLeftColor = color;
            card.style.boxShadow = 'none';
        };
        card.onclick = function () { self._toggleExpand(idx); };

        // ---- card header
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

        // Type badge
        var typeBadge = document.createElement('span');
        typeBadge.style.cssText =
            'font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;' +
            'text-transform:uppercase;letter-spacing:.5px;' +
            'background:' + color + '20;color:' + color + ';';
        typeBadge.textContent = isClick ? 'Click' : (evt.speaker === 'se' ? 'SE' : 'Visitor');
        header.appendChild(typeBadge);

        // Product badge
        var product = this._resolveProduct(evt);
        if (product) {
            var prodBadge = document.createElement('span');
            prodBadge.style.cssText =
                'font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;' +
                'background:rgba(255,255,255,.06);color:#8A92A0;';
            prodBadge.textContent = product;
            header.appendChild(prodBadge);
        }

        card.appendChild(header);

        // ---- card body (summary)
        var body = document.createElement('div');
        body.style.cssText = 'margin-top:6px;font-size:13px;color:#F0F2F5;line-height:1.4;';

        if (isClick) {
            // Screenshot thumbnail + element
            var thumbRow = document.createElement('div');
            thumbRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

            if (evt.screenshot) {
                var thumb = document.createElement('img');
                thumb.src = evt.screenshot;
                thumb.style.cssText =
                    'width:48px;height:28px;object-fit:cover;border-radius:4px;' +
                    'border:1px solid #1E2330;flex-shrink:0;';
                thumb.alt = 'Screenshot';
                thumb.onerror = function () { this.style.display = 'none'; };
                thumbRow.appendChild(thumb);
            }

            var elLabel = document.createElement('span');
            elLabel.style.cssText = 'color:#8A92A0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            elLabel.textContent = evt.element || 'Unknown element';
            thumbRow.appendChild(elLabel);
            body.appendChild(thumbRow);
        } else {
            // Transcript: speaker label + text preview
            var speakerLabel = document.createElement('div');
            speakerLabel.style.cssText =
                'font-size:11px;font-weight:600;color:' + color + ';margin-bottom:2px;';
            speakerLabel.textContent = evt.speaker === 'se' ? 'Sales Engineer' : 'Visitor';
            body.appendChild(speakerLabel);

            var textPrev = document.createElement('div');
            textPrev.style.cssText = 'font-size:12px;color:#8A92A0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;';
            textPrev.textContent = _truncate(evt.text || '', 60);
            body.appendChild(textPrev);
        }

        card.appendChild(body);

        // ---- expanded detail (hidden by default)
        var detail = document.createElement('div');
        detail.className = 'booth-timeline__detail';
        detail.style.cssText = 'display:none;margin-top:10px;padding-top:10px;border-top:1px solid #1E2330;font-size:12px;color:#8A92A0;';
        detail.setAttribute('data-idx', idx);

        if (isClick) {
            var detailLines = [];
            if (evt.x !== undefined) detailLines.push('Position: (' + evt.x + ', ' + evt.y + ')');
            if (evt.url) detailLines.push('URL: ' + evt.url);
            if (evt.element) detailLines.push('Element: ' + evt.element);
            if (evt.screenshot) {
                detailLines.push('');
                var bigThumb = document.createElement('img');
                bigThumb.src = evt.screenshot;
                bigThumb.style.cssText = 'max-width:100%;border-radius:6px;margin-top:6px;border:1px solid #1E2330;';
                bigThumb.alt = 'Click screenshot';
                bigThumb.onerror = function () { this.style.display = 'none'; };
            }
            detail.innerHTML = _esc(detailLines.join('\n')).replace(/\n/g, '<br>');
            if (bigThumb) detail.appendChild(bigThumb);
        } else {
            detail.textContent = evt.text || '(no transcript text)';
            detail.style.whiteSpace = 'pre-wrap';
            detail.style.lineHeight = '1.5';
        }

        card.appendChild(detail);
        row.appendChild(card);
        return row;
    };

    // --------------------------------------------------------- expand/collapse
    BoothTimeline.prototype._toggleExpand = function (idx) {
        var details = this._el.querySelectorAll('.booth-timeline__detail');
        for (var i = 0; i < details.length; i++) {
            var dIdx = parseInt(details[i].getAttribute('data-idx'), 10);
            if (dIdx === idx) {
                var showing = details[i].style.display !== 'none';
                details[i].style.display = showing ? 'none' : 'block';
                this._expandedIdx = showing ? -1 : idx;
            } else {
                details[i].style.display = 'none';
            }
        }
    };

    // --------------------------------------------------------- product resolve
    BoothTimeline.prototype._resolveProduct = function (evt) {
        if (evt.product) return evt.product;
        var url = evt.url || '';
        var lower = url.toLowerCase();
        var keys = Object.keys(PRODUCT_MAP);
        for (var i = 0; i < keys.length; i++) {
            if (lower.indexOf(keys[i]) !== -1) return PRODUCT_MAP[keys[i]];
        }
        return null;
    };

    // --------------------------------------------------------- helpers
    function _truncate(str, max) {
        return str.length > max ? str.substring(0, max) + '...' : str;
    }

    function _esc(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // --------------------------------------------------------- export
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = BoothTimeline;
    } else {
        root.BoothTimeline = BoothTimeline;
    }

})(typeof window !== 'undefined' ? window : this);
