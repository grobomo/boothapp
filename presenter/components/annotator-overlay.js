/**
 * BoothApp Annotator Overlay
 *
 * HTML5 Canvas overlay for drawing annotations on screenshots.
 * Tools: pen, highlighter, text, arrow. Color picker. Undo/redo.
 * Saves annotations to S3 at sessions/<id>/annotations.json.
 *
 * Usage:
 *   var annotator = new BoothAnnotator(containerEl, imageUrl, {
 *     sessionId: 'SESSION-123',
 *     screenshotFile: 'screenshot_001.jpg',
 *     s3: awsS3Instance,       // optional, needed for save/load
 *     bucket: 'bucket-name',   // optional
 *     readOnly: false           // true for share/replay view
 *   });
 */
var BoothAnnotator = (function () {
  'use strict';

  var TOOLS = {
    pen:         { cursor: 'crosshair', lineWidth: 3, globalAlpha: 1.0, compositeOp: 'source-over' },
    highlighter: { cursor: 'crosshair', lineWidth: 20, globalAlpha: 0.35, compositeOp: 'source-over' },
    text:        { cursor: 'text',      lineWidth: 1, globalAlpha: 1.0, compositeOp: 'source-over' },
    arrow:       { cursor: 'crosshair', lineWidth: 3, globalAlpha: 1.0, compositeOp: 'source-over' }
  };

  var DEFAULT_COLORS = ['#ff3b30','#ff9500','#ffcc00','#34c759','#007aff','#af52de','#ffffff','#000000'];
  var ANNOTATIONS_PREFIX = 'annotations.json';

  // ── Constructor ───────────────────────────────────────────────

  function BoothAnnotator(container, imageUrl, opts) {
    opts = opts || {};
    this.container = container;
    this.imageUrl = imageUrl;
    this.sessionId = opts.sessionId || '';
    this.screenshotFile = opts.screenshotFile || '';
    this.s3 = opts.s3 || null;
    this.bucket = opts.bucket || 'boothapp-sessions-752266476357';
    this.readOnly = !!opts.readOnly;
    this.onClose = opts.onClose || null;

    this.currentTool = 'pen';
    this.currentColor = '#ff3b30';
    this.strokes = [];       // committed strokes
    this.undoneStrokes = [];  // redo stack
    this.activeStroke = null; // in-progress stroke
    this.drawing = false;

    this._build();
    this._loadImage();
  }

  // ── DOM Construction ──────────────────────────────────────────

  BoothAnnotator.prototype._build = function () {
    var self = this;

    // Overlay wrapper (fills container, positioned above image)
    this.overlay = document.createElement('div');
    this.overlay.className = 'ba-overlay';
    this.overlay.style.cssText =
      'position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,0.88);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;';

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.className = 'ba-close';
    closeBtn.textContent = 'X';
    closeBtn.title = 'Close annotator';
    closeBtn.style.cssText =
      'position:absolute;top:12px;right:16px;z-index:1200;background:none;border:none;' +
      'color:#fff;font-size:24px;cursor:pointer;font-family:monospace;padding:8px;';
    closeBtn.addEventListener('click', function () { self.close(); });
    this.overlay.appendChild(closeBtn);

    // Canvas wrapper (centers and constrains canvas)
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.style.cssText =
      'position:relative;max-width:95vw;max-height:85vh;display:flex;align-items:center;justify-content:center;';
    this.overlay.appendChild(this.canvasWrap);

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'border-radius:6px;box-shadow:0 4px 30px rgba(0,0,0,0.4);';
    this.canvasWrap.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Toolbar
    if (!this.readOnly) {
      this._buildToolbar();
    }

    // Status indicator (saving...)
    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText =
      'position:absolute;bottom:8px;right:12px;font-size:12px;color:#8b949e;' +
      'font-family:-apple-system,sans-serif;pointer-events:none;';
    this.overlay.appendChild(this.statusEl);

    // Attach to DOM
    (this.container || document.body).appendChild(this.overlay);

    // Canvas events
    if (!this.readOnly) {
      this.canvas.addEventListener('mousedown', function (e) { self._onPointerDown(e); });
      this.canvas.addEventListener('mousemove', function (e) { self._onPointerMove(e); });
      this.canvas.addEventListener('mouseup', function (e) { self._onPointerUp(e); });
      this.canvas.addEventListener('mouseleave', function (e) { self._onPointerUp(e); });
      // Touch support
      this.canvas.addEventListener('touchstart', function (e) { e.preventDefault(); self._onPointerDown(self._touchToMouse(e)); }, { passive: false });
      this.canvas.addEventListener('touchmove', function (e) { e.preventDefault(); self._onPointerMove(self._touchToMouse(e)); }, { passive: false });
      this.canvas.addEventListener('touchend', function (e) { self._onPointerUp(self._touchToMouse(e)); });
    }

    // Keyboard shortcuts
    this._keyHandler = function (e) { self._onKey(e); };
    document.addEventListener('keydown', this._keyHandler);
  };

  BoothAnnotator.prototype._buildToolbar = function () {
    var self = this;
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'ba-toolbar';
    this.toolbar.style.cssText =
      'position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:1200;' +
      'display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:10px;' +
      'background:rgba(22,27,34,0.95);border:1px solid rgba(48,54,61,0.8);' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.4);font-family:-apple-system,sans-serif;';

    // Tool buttons
    var toolDefs = [
      { id: 'pen',         label: '/' ,  title: 'Pen (P)' },
      { id: 'highlighter', label: '||',  title: 'Highlighter (H)' },
      { id: 'text',        label: 'T',   title: 'Text (T)' },
      { id: 'arrow',       label: '->',  title: 'Arrow (A)' }
    ];

    toolDefs.forEach(function (td) {
      var btn = document.createElement('button');
      btn.className = 'ba-tool-btn';
      btn.dataset.tool = td.id;
      btn.textContent = td.label;
      btn.title = td.title;
      btn.style.cssText = self._toolBtnStyle(td.id === self.currentTool);
      btn.addEventListener('click', function () { self._selectTool(td.id); });
      self.toolbar.appendChild(btn);
    });

    // Separator
    this.toolbar.appendChild(this._sep());

    // Color picker
    this.colorBtns = [];
    DEFAULT_COLORS.forEach(function (c) {
      var btn = document.createElement('button');
      btn.className = 'ba-color-btn';
      btn.dataset.color = c;
      btn.title = c;
      btn.style.cssText =
        'width:22px;height:22px;border-radius:50%;border:2px solid ' +
        (c === self.currentColor ? '#fff' : 'transparent') +
        ';background:' + c + ';cursor:pointer;flex-shrink:0;padding:0;';
      btn.addEventListener('click', function () { self._selectColor(c); });
      self.toolbar.appendChild(btn);
      self.colorBtns.push(btn);
    });

    // Custom color input
    this.customColorInput = document.createElement('input');
    this.customColorInput.type = 'color';
    this.customColorInput.value = this.currentColor;
    this.customColorInput.title = 'Custom color';
    this.customColorInput.style.cssText =
      'width:22px;height:22px;border:none;padding:0;background:none;cursor:pointer;' +
      'border-radius:4px;overflow:hidden;';
    this.customColorInput.addEventListener('input', function () {
      self._selectColor(self.customColorInput.value);
    });
    this.toolbar.appendChild(this.customColorInput);

    // Separator
    this.toolbar.appendChild(this._sep());

    // Undo / Redo
    var undoBtn = document.createElement('button');
    undoBtn.textContent = '<-';
    undoBtn.title = 'Undo (Ctrl+Z)';
    undoBtn.style.cssText = this._actionBtnStyle();
    undoBtn.addEventListener('click', function () { self.undo(); });
    this.toolbar.appendChild(undoBtn);

    var redoBtn = document.createElement('button');
    redoBtn.textContent = '->';
    redoBtn.title = 'Redo (Ctrl+Y)';
    redoBtn.style.cssText = this._actionBtnStyle();
    redoBtn.addEventListener('click', function () { self.redo(); });
    this.toolbar.appendChild(redoBtn);

    // Separator
    this.toolbar.appendChild(this._sep());

    // Clear all
    var clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.title = 'Clear all annotations';
    clearBtn.style.cssText = this._actionBtnStyle() + 'color:#f85149;';
    clearBtn.addEventListener('click', function () { self.clearAll(); });
    this.toolbar.appendChild(clearBtn);

    // Save
    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.title = 'Save annotations (Ctrl+S)';
    saveBtn.style.cssText = this._actionBtnStyle() + 'color:#3fb950;';
    saveBtn.addEventListener('click', function () { self.save(); });
    this.toolbar.appendChild(saveBtn);

    this.overlay.appendChild(this.toolbar);
  };

  BoothAnnotator.prototype._sep = function () {
    var d = document.createElement('div');
    d.style.cssText = 'width:1px;height:24px;background:rgba(48,54,61,0.8);flex-shrink:0;';
    return d;
  };

  BoothAnnotator.prototype._toolBtnStyle = function (active) {
    return 'padding:6px 10px;border-radius:6px;border:1px solid ' +
      (active ? '#58a6ff' : 'transparent') +
      ';background:' + (active ? 'rgba(88,166,255,0.15)' : 'transparent') +
      ';color:' + (active ? '#58a6ff' : '#e6edf3') +
      ';cursor:pointer;font-size:13px;font-weight:600;font-family:monospace;';
  };

  BoothAnnotator.prototype._actionBtnStyle = function () {
    return 'padding:4px 10px;border-radius:6px;border:1px solid rgba(48,54,61,0.8);' +
      'background:transparent;color:#e6edf3;cursor:pointer;font-size:12px;' +
      'font-family:-apple-system,sans-serif;';
  };

  // ── Image Loading ─────────────────────────────────────────────

  BoothAnnotator.prototype._loadImage = function () {
    var self = this;
    this.img = new Image();
    this.img.crossOrigin = 'anonymous';
    this.img.onload = function () {
      self._sizeCanvas();
      self._redraw();
      self._loadAnnotations();
    };
    this.img.onerror = function () {
      self.statusEl.textContent = 'Failed to load image';
    };
    this.img.src = this.imageUrl;
  };

  BoothAnnotator.prototype._sizeCanvas = function () {
    // Fit image within viewport
    var maxW = window.innerWidth * 0.93;
    var maxH = window.innerHeight * 0.83;
    var iw = this.img.naturalWidth;
    var ih = this.img.naturalHeight;
    var scale = Math.min(1, maxW / iw, maxH / ih);
    this.displayW = Math.round(iw * scale);
    this.displayH = Math.round(ih * scale);
    this.scaleX = iw / this.displayW;
    this.scaleY = ih / this.displayH;

    this.canvas.width = iw;
    this.canvas.height = ih;
    this.canvas.style.width = this.displayW + 'px';
    this.canvas.style.height = this.displayH + 'px';
    this.canvas.style.cursor = TOOLS[this.currentTool].cursor;
  };

  // ── Coordinate Helpers ────────────────────────────────────────

  BoothAnnotator.prototype._canvasXY = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * this.scaleX,
      y: (e.clientY - rect.top) * this.scaleY
    };
  };

  BoothAnnotator.prototype._touchToMouse = function (e) {
    if (e.touches && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
    }
    return { clientX: 0, clientY: 0 };
  };

  // ── Drawing Events ────────────────────────────────────────────

  BoothAnnotator.prototype._onPointerDown = function (e) {
    var pt = this._canvasXY(e);

    if (this.currentTool === 'text') {
      this._promptText(pt);
      return;
    }

    this.drawing = true;
    this.activeStroke = {
      tool: this.currentTool,
      color: this.currentColor,
      points: [pt]
    };
  };

  BoothAnnotator.prototype._onPointerMove = function (e) {
    if (!this.drawing || !this.activeStroke) return;
    var pt = this._canvasXY(e);
    this.activeStroke.points.push(pt);
    this._redraw();
    this._drawStroke(this.activeStroke, true);
  };

  BoothAnnotator.prototype._onPointerUp = function () {
    if (!this.drawing || !this.activeStroke) return;
    this.drawing = false;

    // Only commit if the stroke has more than one point (or is an arrow)
    if (this.activeStroke.points.length > 1) {
      this.strokes.push(this.activeStroke);
      this.undoneStrokes = []; // clear redo stack on new stroke
    }
    this.activeStroke = null;
    this._redraw();
  };

  BoothAnnotator.prototype._promptText = function (pt) {
    var text = prompt('Enter annotation text:');
    if (!text) return;
    this.strokes.push({
      tool: 'text',
      color: this.currentColor,
      points: [pt],
      text: text
    });
    this.undoneStrokes = [];
    this._redraw();
  };

  // ── Keyboard ──────────────────────────────────────────────────

  BoothAnnotator.prototype._onKey = function (e) {
    // Only handle if overlay is visible
    if (!this.overlay || !this.overlay.parentNode) return;

    if (e.key === 'Escape') {
      this.close();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      this.redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      this.save();
      return;
    }

    // Tool shortcuts (only when not typing)
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'p') this._selectTool('pen');
      if (e.key === 'h') this._selectTool('highlighter');
      if (e.key === 't') this._selectTool('text');
      if (e.key === 'a') this._selectTool('arrow');
    }
  };

  // ── Tool / Color Selection ────────────────────────────────────

  BoothAnnotator.prototype._selectTool = function (toolId) {
    this.currentTool = toolId;
    this.canvas.style.cursor = TOOLS[toolId].cursor;

    // Update toolbar button styles
    if (this.toolbar) {
      var btns = this.toolbar.querySelectorAll('.ba-tool-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].style.cssText = this._toolBtnStyle(btns[i].dataset.tool === toolId);
      }
    }
  };

  BoothAnnotator.prototype._selectColor = function (color) {
    this.currentColor = color;
    if (this.customColorInput) this.customColorInput.value = color;
    if (this.colorBtns) {
      this.colorBtns.forEach(function (btn) {
        btn.style.borderColor = (btn.dataset.color === color) ? '#fff' : 'transparent';
      });
    }
  };

  // ── Undo / Redo ───────────────────────────────────────────────

  BoothAnnotator.prototype.undo = function () {
    if (this.strokes.length === 0) return;
    this.undoneStrokes.push(this.strokes.pop());
    this._redraw();
  };

  BoothAnnotator.prototype.redo = function () {
    if (this.undoneStrokes.length === 0) return;
    this.strokes.push(this.undoneStrokes.pop());
    this._redraw();
  };

  BoothAnnotator.prototype.clearAll = function () {
    if (this.strokes.length === 0) return;
    this.undoneStrokes = this.strokes.slice();
    this.strokes = [];
    this._redraw();
  };

  // ── Rendering ─────────────────────────────────────────────────

  BoothAnnotator.prototype._redraw = function () {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw background image
    if (this.img && this.img.complete) {
      ctx.drawImage(this.img, 0, 0, this.canvas.width, this.canvas.height);
    }

    // Draw all committed strokes
    for (var i = 0; i < this.strokes.length; i++) {
      this._drawStroke(this.strokes[i], false);
    }
  };

  BoothAnnotator.prototype._drawStroke = function (stroke, isActive) {
    var ctx = this.ctx;
    var tool = TOOLS[stroke.tool] || TOOLS.pen;

    ctx.save();
    ctx.globalAlpha = tool.globalAlpha;
    ctx.globalCompositeOperation = tool.compositeOp;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = tool.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'text') {
      this._drawText(ctx, stroke);
    } else if (stroke.tool === 'arrow') {
      this._drawArrow(ctx, stroke, isActive);
    } else {
      this._drawFreehand(ctx, stroke);
    }

    ctx.restore();
  };

  BoothAnnotator.prototype._drawFreehand = function (ctx, stroke) {
    var pts = stroke.points;
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  };

  BoothAnnotator.prototype._drawArrow = function (ctx, stroke, isActive) {
    var pts = stroke.points;
    if (pts.length < 2) return;

    var start = pts[0];
    var end = pts[pts.length - 1];
    var angle = Math.atan2(end.y - start.y, end.x - start.x);
    var headLen = Math.max(15, ctx.lineWidth * 5);

    // Shaft
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(
      end.x - headLen * Math.cos(angle - Math.PI / 6),
      end.y - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      end.x - headLen * Math.cos(angle + Math.PI / 6),
      end.y - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  };

  BoothAnnotator.prototype._drawText = function (ctx, stroke) {
    var pt = stroke.points[0];
    var text = stroke.text || '';
    var fontSize = 24;
    ctx.font = 'bold ' + fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.globalAlpha = 1.0;

    // Background box
    var metrics = ctx.measureText(text);
    var pad = 8;
    var tw = metrics.width + pad * 2;
    var th = fontSize + pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(pt.x - pad, pt.y - fontSize - pad, tw, th);

    // Text
    ctx.fillStyle = stroke.color;
    ctx.fillText(text, pt.x, pt.y);
  };

  // ── Save / Load Annotations ───────────────────────────────────

  BoothAnnotator.prototype._s3Key = function () {
    return 'sessions/' + this.sessionId + '/' + ANNOTATIONS_PREFIX;
  };

  BoothAnnotator.prototype._serializeStrokes = function () {
    return this.strokes.map(function (s) {
      var obj = { tool: s.tool, color: s.color, points: s.points };
      if (s.text) obj.text = s.text;
      return obj;
    });
  };

  BoothAnnotator.prototype.save = function () {
    var self = this;
    if (!this.s3 || !this.sessionId) {
      this.statusEl.textContent = 'Cannot save (no S3 / session ID)';
      setTimeout(function () { self.statusEl.textContent = ''; }, 3000);
      return;
    }

    this.statusEl.textContent = 'Saving...';

    // Load existing annotations file, merge, save
    var key = this._s3Key();
    this.s3.getObject({ Bucket: this.bucket, Key: key }, function (err, data) {
      var existing = {};
      if (!err && data && data.Body) {
        try { existing = JSON.parse(data.Body.toString()); } catch (e) { existing = {}; }
      }
      if (!existing.annotations) existing.annotations = {};

      existing.annotations[self.screenshotFile] = {
        strokes: self._serializeStrokes(),
        updated_at: new Date().toISOString()
      };
      existing.session_id = self.sessionId;
      existing.updated_at = new Date().toISOString();

      self.s3.putObject({
        Bucket: self.bucket,
        Key: key,
        Body: JSON.stringify(existing, null, 2),
        ContentType: 'application/json'
      }, function (putErr) {
        if (putErr) {
          self.statusEl.textContent = 'Save failed: ' + putErr.message;
        } else {
          self.statusEl.textContent = 'Saved';
        }
        setTimeout(function () { self.statusEl.textContent = ''; }, 3000);
      });
    });
  };

  BoothAnnotator.prototype._loadAnnotations = function () {
    var self = this;
    if (!this.s3 || !this.sessionId || !this.screenshotFile) return;

    var key = this._s3Key();
    this.s3.getObject({ Bucket: this.bucket, Key: key }, function (err, data) {
      if (err || !data || !data.Body) return;
      try {
        var parsed = JSON.parse(data.Body.toString());
        var forFile = parsed.annotations && parsed.annotations[self.screenshotFile];
        if (forFile && forFile.strokes) {
          self.strokes = forFile.strokes;
          self._redraw();
        }
      } catch (e) {
        // ignore parse errors
      }
    });
  };

  // ── Close / Destroy ───────────────────────────────────────────

  BoothAnnotator.prototype.close = function () {
    document.removeEventListener('keydown', this._keyHandler);
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    if (typeof this.onClose === 'function') this.onClose();
  };

  // ── Static: render annotations onto an existing image element ─
  // Used by replay/share views to show saved annotations read-only.

  BoothAnnotator.renderOntoImage = function (imgEl, strokes) {
    if (!strokes || strokes.length === 0) return;

    var wrapper = imgEl.parentNode;
    if (!wrapper) return;

    // Ensure wrapper is positioned
    var pos = window.getComputedStyle(wrapper).position;
    if (pos === 'static') wrapper.style.position = 'relative';

    var canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';

    // Wait for image to have dimensions
    function setup() {
      canvas.width = imgEl.naturalWidth || imgEl.width;
      canvas.height = imgEl.naturalHeight || imgEl.height;

      var tempAnnotator = new BoothAnnotator.__StrokeRenderer(canvas.getContext('2d'));
      for (var i = 0; i < strokes.length; i++) {
        tempAnnotator.drawStroke(strokes[i]);
      }
      wrapper.appendChild(canvas);
    }

    if (imgEl.complete && imgEl.naturalWidth > 0) {
      setup();
    } else {
      imgEl.addEventListener('load', setup);
    }
  };

  // Minimal stroke renderer for read-only overlay
  BoothAnnotator.__StrokeRenderer = function (ctx) { this.ctx = ctx; };
  BoothAnnotator.__StrokeRenderer.prototype.drawStroke = function (stroke) {
    var ctx = this.ctx;
    var tool = TOOLS[stroke.tool] || TOOLS.pen;
    ctx.save();
    ctx.globalAlpha = tool.globalAlpha;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = tool.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'text') {
      var pt = stroke.points[0];
      var fontSize = 24;
      ctx.font = 'bold ' + fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.globalAlpha = 1.0;
      var metrics = ctx.measureText(stroke.text || '');
      var pad = 8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(pt.x - pad, pt.y - fontSize - pad, metrics.width + pad * 2, fontSize + pad * 2);
      ctx.fillStyle = stroke.color;
      ctx.fillText(stroke.text || '', pt.x, pt.y);
    } else if (stroke.tool === 'arrow') {
      var pts = stroke.points;
      if (pts.length >= 2) {
        var start = pts[0], end = pts[pts.length - 1];
        var angle = Math.atan2(end.y - start.y, end.x - start.x);
        var headLen = Math.max(15, ctx.lineWidth * 5);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
    } else {
      var fpts = stroke.points;
      if (fpts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(fpts[0].x, fpts[0].y);
        for (var i = 1; i < fpts.length; i++) {
          ctx.lineTo(fpts[i].x, fpts[i].y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  return BoothAnnotator;
})();

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BoothAnnotator;
}
