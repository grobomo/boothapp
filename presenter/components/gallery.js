/**
 * BoothApp Screenshot Gallery Component
 *
 * Usage:
 *   <div id="gallery"></div>
 *   <script src="components/gallery.js"></script>
 *   <script>BoothGallery.init('gallery', 'SESSION_ID');</script>
 *
 * Dependencies: JSZip (loaded from CDN on demand for ZIP export)
 */
var BoothGallery = (function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────
  var THUMB_W = 200;
  var THUMB_H = 150;
  var API_BASE = '/api/session';

  // ── State ───────────────────────────────────────────────────────────────
  var containerEl = null;
  var sessionId = null;
  var screenshots = [];
  var clicks = [];      // click events keyed by screenshot filename
  var clickMap = {};     // filename -> click event
  var lightboxIndex = -1;
  var observer = null;

  // ── CSS injection ───────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('booth-gallery-css')) return;
    var style = document.createElement('style');
    style.id = 'booth-gallery-css';
    style.textContent = [
      // Grid
      '.bg-toolbar { display:flex; align-items:center; gap:0.8rem; padding:0.8rem 1rem;' +
        'background:var(--surface,#161b22); border-bottom:1px solid var(--border,#30363d);' +
        'flex-wrap:wrap; }',
      '.bg-toolbar .bg-count { font-size:0.85rem; color:var(--text-muted,#8b949e); }',
      '.bg-toolbar button { background:none; border:1px solid var(--border,#30363d);' +
        'color:var(--text,#e6edf3); padding:0.4rem 0.9rem; border-radius:6px; cursor:pointer;' +
        'font-size:0.85rem; transition:border-color 0.15s,background 0.15s; }',
      '.bg-toolbar button:hover { border-color:var(--accent,#58a6ff);' +
        'background:rgba(88,166,255,0.1); }',
      '.bg-toolbar .spacer { flex:1; }',

      '.bg-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr));' +
        'gap:12px; padding:1rem; }',

      // Card
      '.bg-card { position:relative; background:var(--surface,#161b22);' +
        'border:1px solid var(--border,#30363d); border-radius:8px; overflow:hidden;' +
        'cursor:pointer; transition:border-color 0.15s,transform 0.1s; }',
      '.bg-card:hover { border-color:var(--accent,#58a6ff); transform:translateY(-2px); }',
      '.bg-card .bg-thumb { width:100%; height:150px; object-fit:cover;' +
        'background:var(--bg,#0d1117); display:block; }',
      '.bg-card .bg-placeholder { width:100%; height:150px; display:flex;' +
        'align-items:center; justify-content:center; background:var(--bg,#0d1117);' +
        'color:var(--text-muted,#8b949e); font-size:0.8rem; }',
      '.bg-card .bg-label { padding:0.4rem 0.6rem; font-size:0.75rem;' +
        'color:var(--text-muted,#8b949e); font-family:monospace;' +
        'white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '.bg-card .bg-click-badge { position:absolute; top:6px; right:6px;' +
        'background:rgba(248,81,73,0.85); color:#fff; font-size:0.7rem;' +
        'padding:2px 6px; border-radius:4px; pointer-events:none; }',
      '.bg-card .bg-dl-btn { position:absolute; top:6px; left:6px;' +
        'background:rgba(22,27,34,0.85); border:1px solid rgba(48,54,61,0.8);' +
        'color:var(--text,#e6edf3); width:28px; height:28px; border-radius:6px;' +
        'display:flex; align-items:center; justify-content:center; cursor:pointer;' +
        'opacity:0; transition:opacity 0.15s; font-size:0.9rem; }',
      '.bg-card:hover .bg-dl-btn { opacity:1; }',

      // Lightbox
      '.bg-lightbox { position:fixed; inset:0; z-index:10000;' +
        'background:rgba(0,0,0,0.92); display:flex; flex-direction:column; }',
      '.bg-lb-header { display:flex; align-items:center; padding:0.6rem 1rem;' +
        'background:rgba(22,27,34,0.95); border-bottom:1px solid var(--border,#30363d);' +
        'gap:0.8rem; flex-shrink:0; }',
      '.bg-lb-header .bg-lb-title { font-size:0.9rem; color:var(--text,#e6edf3);' +
        'font-family:monospace; }',
      '.bg-lb-header .bg-lb-counter { font-size:0.85rem; color:var(--text-muted,#8b949e); }',
      '.bg-lb-header .spacer { flex:1; }',
      '.bg-lb-header button { background:none; border:1px solid var(--border,#30363d);' +
        'color:var(--text,#e6edf3); padding:0.3rem 0.7rem; border-radius:6px;' +
        'cursor:pointer; font-size:0.85rem; }',
      '.bg-lb-header button:hover { border-color:var(--accent,#58a6ff);' +
        'background:rgba(88,166,255,0.1); }',

      '.bg-lb-body { flex:1; display:flex; align-items:center; justify-content:center;' +
        'position:relative; min-height:0; overflow:hidden; }',
      '.bg-lb-body .bg-lb-img-wrap { position:relative; max-width:100%; max-height:100%;' +
        'display:flex; align-items:center; justify-content:center; }',
      '.bg-lb-body img { max-width:calc(100vw - 120px); max-height:calc(100vh - 120px);' +
        'object-fit:contain; display:block; }',

      // Click annotation in lightbox
      '.bg-click-overlay { position:absolute; pointer-events:none; }',
      '.bg-click-ring { width:40px; height:40px; border:3px solid #f85149;' +
        'border-radius:50%; position:absolute; transform:translate(-50%,-50%);' +
        'animation:bg-pulse 1.5s ease-out infinite;' +
        'box-shadow:0 0 12px rgba(248,81,73,0.5); }',
      '.bg-click-dot { width:10px; height:10px; background:#f85149; border-radius:50%;' +
        'position:absolute; transform:translate(-50%,-50%);' +
        'box-shadow:0 0 8px rgba(248,81,73,0.8); }',
      '.bg-click-label { position:absolute; transform:translate(-50%,24px);' +
        'background:rgba(248,81,73,0.9); color:#fff; font-size:0.7rem;' +
        'padding:2px 8px; border-radius:4px; white-space:nowrap;' +
        'font-family:monospace; }',
      '@keyframes bg-pulse { 0%{transform:translate(-50%,-50%) scale(1);opacity:1}' +
        '100%{transform:translate(-50%,-50%) scale(2);opacity:0} }',

      // Nav arrows
      '.bg-lb-nav { position:absolute; top:50%; transform:translateY(-50%);' +
        'background:rgba(22,27,34,0.8); border:1px solid var(--border,#30363d);' +
        'color:var(--text,#e6edf3); width:44px; height:44px; border-radius:50%;' +
        'display:flex; align-items:center; justify-content:center; cursor:pointer;' +
        'font-size:1.4rem; transition:background 0.15s; z-index:2; }',
      '.bg-lb-nav:hover { background:rgba(88,166,255,0.2); }',
      '.bg-lb-nav.prev { left:16px; }',
      '.bg-lb-nav.next { right:16px; }',

      // Info panel in lightbox
      '.bg-lb-info { flex-shrink:0; padding:0.6rem 1rem;' +
        'background:rgba(22,27,34,0.95); border-top:1px solid var(--border,#30363d);' +
        'display:flex; gap:2rem; font-size:0.8rem; color:var(--text-muted,#8b949e);' +
        'font-family:monospace; overflow:hidden; }',
      '.bg-lb-info span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '.bg-lb-info .accent { color:var(--accent,#58a6ff); }',

      // Loading / error
      '.bg-loading { display:flex; align-items:center; justify-content:center;' +
        'padding:4rem; color:var(--text-muted,#8b949e); font-size:1rem; }',
      '.bg-spinner { display:inline-block; width:16px; height:16px;' +
        'border:2px solid var(--border,#30363d); border-top-color:var(--accent,#58a6ff);' +
        'border-radius:50%; animation:bg-spin 0.8s linear infinite; margin-left:0.5rem; }',
      '@keyframes bg-spin { to{transform:rotate(360deg)} }',
      '.bg-error { padding:4rem; text-align:center; color:#f85149; font-size:1rem; }',
      '.bg-empty { padding:4rem; text-align:center; color:var(--text-muted,#8b949e); }',

      // ZIP progress
      '.bg-zip-progress { font-size:0.8rem; color:var(--accent,#58a6ff); }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Fetch data ──────────────────────────────────────────────────────────
  function fetchScreenshots(sid) {
    return fetch(API_BASE + '/' + encodeURIComponent(sid) + '/screenshots')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  // ── Build click map (filename -> click event) ──────────────────────────
  function buildClickMap(clickEvents) {
    clickMap = {};
    for (var i = 0; i < clickEvents.length; i++) {
      var evt = clickEvents[i];
      if (evt.screenshot_file) {
        var fname = evt.screenshot_file.split('/').pop();
        clickMap[fname] = evt;
      }
    }
  }

  // ── Render grid ─────────────────────────────────────────────────────────
  function renderGrid() {
    containerEl.innerHTML = '';

    // Toolbar
    var toolbar = document.createElement('div');
    toolbar.className = 'bg-toolbar';
    toolbar.innerHTML =
      '<span class="bg-count">' + screenshots.length + ' screenshots</span>' +
      '<span class="spacer"></span>' +
      '<button id="bg-export-zip">Export ZIP</button>';
    containerEl.appendChild(toolbar);

    document.getElementById('bg-export-zip').addEventListener('click', exportZip);

    // Grid
    var grid = document.createElement('div');
    grid.className = 'bg-grid';
    containerEl.appendChild(grid);

    // Create Intersection Observer for lazy loading
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          loadThumb(entries[i].target);
          observer.unobserve(entries[i].target);
        }
      }
    }, { rootMargin: '200px' });

    for (var i = 0; i < screenshots.length; i++) {
      var card = createCard(i);
      grid.appendChild(card);
    }
  }

  function createCard(index) {
    var shot = screenshots[index];
    var click = clickMap[shot.filename] || null;

    var card = document.createElement('div');
    card.className = 'bg-card';
    card.setAttribute('data-index', index);

    // Placeholder (replaced by lazy-loaded thumb)
    var placeholder = document.createElement('div');
    placeholder.className = 'bg-placeholder';
    placeholder.textContent = 'Loading...';
    placeholder.setAttribute('data-src', shot.url);
    card.appendChild(placeholder);

    // Click badge
    if (click) {
      var badge = document.createElement('div');
      badge.className = 'bg-click-badge';
      var tag = click.element ? '<' + (click.element.tag || '?') + '>' : 'click';
      badge.textContent = tag;
      card.appendChild(badge);
    }

    // Download button
    var dlBtn = document.createElement('div');
    dlBtn.className = 'bg-dl-btn';
    dlBtn.innerHTML = '&#8615;';
    dlBtn.title = 'Download';
    dlBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      downloadOne(index);
    });
    card.appendChild(dlBtn);

    // Label
    var label = document.createElement('div');
    label.className = 'bg-label';
    label.textContent = shot.filename;
    card.appendChild(label);

    // Click to open lightbox
    card.addEventListener('click', function () {
      openLightbox(index);
    });

    // Observe for lazy loading
    observer.observe(placeholder);

    return card;
  }

  function loadThumb(placeholderEl) {
    var src = placeholderEl.getAttribute('data-src');
    if (!src) return;

    var img = document.createElement('img');
    img.className = 'bg-thumb';
    img.alt = 'Screenshot thumbnail';
    img.loading = 'lazy';
    img.src = src;
    img.onload = function () {
      placeholderEl.parentNode.replaceChild(img, placeholderEl);
    };
    img.onerror = function () {
      placeholderEl.textContent = 'Failed';
    };
  }

  // ── Lightbox ────────────────────────────────────────────────────────────
  function openLightbox(index) {
    lightboxIndex = index;
    var lb = document.createElement('div');
    lb.className = 'bg-lightbox';
    lb.id = 'bg-lightbox';

    lb.innerHTML =
      '<div class="bg-lb-header">' +
        '<span class="bg-lb-title" id="bg-lb-title"></span>' +
        '<span class="bg-lb-counter" id="bg-lb-counter"></span>' +
        '<span class="spacer"></span>' +
        '<button id="bg-lb-dl">Download</button>' +
        '<button id="bg-lb-close">Close (Esc)</button>' +
      '</div>' +
      '<div class="bg-lb-body" id="bg-lb-body">' +
        '<div class="bg-lb-nav prev" id="bg-lb-prev">&#9664;</div>' +
        '<div class="bg-lb-img-wrap" id="bg-lb-img-wrap">' +
          '<img id="bg-lb-img" src="" alt="Full screenshot">' +
          '<div class="bg-click-overlay" id="bg-lb-click-overlay"></div>' +
        '</div>' +
        '<div class="bg-lb-nav next" id="bg-lb-next">&#9654;</div>' +
      '</div>' +
      '<div class="bg-lb-info" id="bg-lb-info"></div>';

    document.body.appendChild(lb);

    document.getElementById('bg-lb-close').addEventListener('click', closeLightbox);
    document.getElementById('bg-lb-prev').addEventListener('click', function () { lbNav(-1); });
    document.getElementById('bg-lb-next').addEventListener('click', function () { lbNav(1); });
    document.getElementById('bg-lb-dl').addEventListener('click', function () {
      downloadOne(lightboxIndex);
    });

    // Click backdrop to close
    document.getElementById('bg-lb-body').addEventListener('click', function (e) {
      if (e.target === this) closeLightbox();
    });

    document.addEventListener('keydown', lbKeyHandler);

    showLightboxImage(index);
  }

  function closeLightbox() {
    var lb = document.getElementById('bg-lightbox');
    if (lb) lb.remove();
    document.removeEventListener('keydown', lbKeyHandler);
    lightboxIndex = -1;
  }

  function lbKeyHandler(e) {
    switch (e.key) {
      case 'Escape':
        closeLightbox();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        lbNav(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        lbNav(1);
        break;
    }
  }

  function lbNav(delta) {
    var next = lightboxIndex + delta;
    if (next < 0 || next >= screenshots.length) return;
    lightboxIndex = next;
    showLightboxImage(next);
  }

  function showLightboxImage(index) {
    var shot = screenshots[index];
    var click = clickMap[shot.filename] || null;

    var img = document.getElementById('bg-lb-img');
    img.src = shot.url;

    document.getElementById('bg-lb-title').textContent = shot.filename;
    document.getElementById('bg-lb-counter').textContent =
      (index + 1) + ' / ' + screenshots.length;

    // Toggle nav visibility
    document.getElementById('bg-lb-prev').style.visibility = index > 0 ? 'visible' : 'hidden';
    document.getElementById('bg-lb-next').style.visibility =
      index < screenshots.length - 1 ? 'visible' : 'hidden';

    // Click annotation overlay
    var overlay = document.getElementById('bg-lb-click-overlay');
    overlay.innerHTML = '';

    if (click && click.coordinates) {
      // Position after image loads
      var positionClick = function () {
        var imgW = img.naturalWidth || 1;
        var imgH = img.naturalHeight || 1;
        var dispW = img.clientWidth;
        var dispH = img.clientHeight;
        var scaleX = dispW / imgW;
        var scaleY = dispH / imgH;
        var cx = click.coordinates.x * scaleX;
        var cy = click.coordinates.y * scaleY;

        overlay.style.width = dispW + 'px';
        overlay.style.height = dispH + 'px';
        overlay.style.left = img.offsetLeft + 'px';
        overlay.style.top = img.offsetTop + 'px';

        var ring = document.createElement('div');
        ring.className = 'bg-click-ring';
        ring.style.left = cx + 'px';
        ring.style.top = cy + 'px';
        overlay.appendChild(ring);

        var dot = document.createElement('div');
        dot.className = 'bg-click-dot';
        dot.style.left = cx + 'px';
        dot.style.top = cy + 'px';
        overlay.appendChild(dot);

        // Label
        if (click.element) {
          var label = document.createElement('div');
          label.className = 'bg-click-label';
          label.style.left = cx + 'px';
          label.style.top = cy + 'px';
          var text = '<' + (click.element.tag || '?') + '>';
          if (click.element.text) text += ' ' + click.element.text.slice(0, 30);
          label.textContent = text;
          overlay.appendChild(label);
        }
      };

      if (img.complete && img.naturalWidth > 0) {
        positionClick();
      } else {
        img.onload = positionClick;
      }
    }

    // Info panel
    var info = document.getElementById('bg-lb-info');
    var parts = [];
    if (click) {
      if (click.dom_path) parts.push('<span class="accent">' + escHtml(click.dom_path) + '</span>');
      if (click.page_url) parts.push('<span>' + escHtml(click.page_url) + '</span>');
      if (click.timestamp) parts.push('<span>' + escHtml(formatTs(click.timestamp)) + '</span>');
      if (click.coordinates) parts.push('<span>(' + click.coordinates.x + ', ' + click.coordinates.y + ')</span>');
    }
    if (shot.size) parts.push('<span>' + formatBytes(shot.size) + '</span>');
    info.innerHTML = parts.join('');
  }

  // ── Download helpers ────────────────────────────────────────────────────
  function downloadOne(index) {
    var shot = screenshots[index];
    var a = document.createElement('a');
    a.href = shot.url;
    a.download = shot.filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function exportZip() {
    var btn = document.getElementById('bg-export-zip');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Preparing...';

    loadJSZip().then(function () {
      var zip = new JSZip();
      var folder = zip.folder(sessionId + '-screenshots');
      var done = 0;
      var total = screenshots.length;

      var promises = screenshots.map(function (shot) {
        return fetch(shot.url)
          .then(function (r) { return r.blob(); })
          .then(function (blob) {
            folder.file(shot.filename, blob);
            done++;
            btn.textContent = 'Packing ' + done + '/' + total + '...';
          });
      });

      return Promise.all(promises).then(function () {
        btn.textContent = 'Generating ZIP...';
        return zip.generateAsync({ type: 'blob' });
      });
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = sessionId + '-screenshots.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      btn.disabled = false;
      btn.textContent = 'Export ZIP';
    }).catch(function (err) {
      console.error('[gallery] ZIP export failed:', err);
      btn.disabled = false;
      btn.textContent = 'Export ZIP (failed)';
    });
  }

  function loadJSZip() {
    if (typeof JSZip !== 'undefined') return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Failed to load JSZip')); };
      document.head.appendChild(script);
    });
  }

  // ── Utilities ───────────────────────────────────────────────────────────
  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function formatTs(ts) {
    try {
      var d = new Date(ts);
      return d.toLocaleTimeString();
    } catch (e) {
      return ts;
    }
  }

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }

  // ── Public API ──────────────────────────────────────────────────────────
  function init(elementId, sid) {
    injectStyles();
    containerEl = document.getElementById(elementId);
    sessionId = sid;

    if (!containerEl) {
      console.error('[gallery] Element #' + elementId + ' not found');
      return;
    }

    containerEl.innerHTML = '<div class="bg-loading">Loading screenshots<span class="bg-spinner"></span></div>';

    fetchScreenshots(sid)
      .then(function (data) {
        screenshots = data.screenshots || [];
        clicks = data.clicks || [];
        buildClickMap(clicks);

        if (screenshots.length === 0) {
          containerEl.innerHTML = '<div class="bg-empty">No screenshots found for session ' + escHtml(sid) + '</div>';
          return;
        }

        renderGrid();
      })
      .catch(function (err) {
        containerEl.innerHTML = '<div class="bg-error">Failed to load screenshots: ' + escHtml(err.message) + '</div>';
      });
  }

  return { init: init };
})();
