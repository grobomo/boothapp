(function() {
  'use strict';

  var NAV_LINKS = [
    { label: 'Home', href: '/' },
    { label: 'Sessions', href: '/sessions.html' },
    { label: 'Analytics', href: '/analytics.html' },
    { label: 'Live Monitor', href: '/live-dashboard.html' },
    { label: 'Admin', href: '/admin.html' },
    { label: 'API Docs', href: '/api-docs.html' },
    { label: 'Setup', href: '/quick-setup.html' }
  ];

  var HEALTH_POLL_MS = 10000;
  var healthy = null; // null = unknown, true = ok, false = down

  function isActive(href) {
    var path = window.location.pathname;
    if (href === '/') return path === '/' || path === '/index.html';
    return path === href;
  }

  function injectStyles() {
    var css = [
      '#ba-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 9999;',
      '  height: 56px; display: flex; align-items: center; justify-content: space-between;',
      '  padding: 0 1.5rem;',
      '  background: rgba(13, 17, 23, 0.75);',
      '  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);',
      '  border-bottom: 1px solid rgba(48, 54, 61, 0.6);',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;',
      '  box-sizing: border-box; }',

      '#ba-nav * { box-sizing: border-box; }',

      '#ba-nav .ba-logo { font-size: 1.15rem; font-weight: 700; color: #e6edf3;',
      '  text-decoration: none; display: flex; align-items: center; gap: 0.5rem;',
      '  letter-spacing: -0.02em; }',
      '#ba-nav .ba-logo span { background: linear-gradient(135deg, #58a6ff, #a371f7);',
      '  -webkit-background-clip: text; -webkit-text-fill-color: transparent;',
      '  background-clip: text; }',

      '#ba-nav .ba-links { display: flex; align-items: center; gap: 0.25rem; list-style: none;',
      '  margin: 0; padding: 0; }',
      '#ba-nav .ba-links a { color: #8b949e; text-decoration: none; font-size: 0.875rem;',
      '  padding: 0.4rem 0.75rem; border-radius: 6px; transition: color 0.15s, background 0.15s; }',
      '#ba-nav .ba-links a:hover { color: #e6edf3; background: rgba(88,166,255,0.08); }',
      '#ba-nav .ba-links a.active { color: #58a6ff; background: rgba(88,166,255,0.12); }',

      '#ba-nav .ba-right { display: flex; align-items: center; gap: 0.75rem; }',

      '#ba-nav .ba-health { width: 10px; height: 10px; border-radius: 50%;',
      '  background: #484f58; transition: background 0.3s, box-shadow 0.3s;',
      '  flex-shrink: 0; }',
      '#ba-nav .ba-health.ok { background: #3fb950; box-shadow: 0 0 6px rgba(63,185,80,0.5); }',
      '#ba-nav .ba-health.err { background: #f85149; box-shadow: 0 0 6px rgba(248,81,73,0.5); }',

      '#ba-nav .ba-hamburger { display: none; background: none; border: none; cursor: pointer;',
      '  padding: 0.25rem; color: #8b949e; }',
      '#ba-nav .ba-hamburger svg { display: block; }',

      '@media (max-width: 768px) {',
      '  #ba-nav .ba-links { display: none; position: fixed; top: 56px; left: 0; right: 0;',
      '    flex-direction: column; padding: 0.5rem;',
      '    background: rgba(13, 17, 23, 0.95);',
      '    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);',
      '    border-bottom: 1px solid rgba(48, 54, 61, 0.6); }',
      '  #ba-nav .ba-links.open { display: flex; }',
      '  #ba-nav .ba-links a { padding: 0.65rem 1rem; font-size: 1rem; }',
      '  #ba-nav .ba-hamburger { display: block; }',
      '}',

      'body { padding-top: 56px !important; }'
    ].join('\n');

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildNav() {
    var nav = document.createElement('nav');
    nav.id = 'ba-nav';

    // Logo
    var logo = document.createElement('a');
    logo.href = '/';
    logo.className = 'ba-logo';
    logo.innerHTML = '<span>BoothApp</span>';

    // Links
    var ul = document.createElement('ul');
    ul.className = 'ba-links';
    NAV_LINKS.forEach(function(link) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.label;
      if (isActive(link.href)) a.className = 'active';
      li.appendChild(a);
      ul.appendChild(li);
    });

    // Right section: health dot + hamburger
    var right = document.createElement('div');
    right.className = 'ba-right';

    var healthDot = document.createElement('div');
    healthDot.className = 'ba-health';
    healthDot.title = 'System health: checking...';

    var hamburger = document.createElement('button');
    hamburger.className = 'ba-hamburger';
    hamburger.setAttribute('aria-label', 'Toggle menu');
    hamburger.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

    hamburger.addEventListener('click', function() {
      ul.classList.toggle('open');
    });

    // Close mobile menu on link click
    ul.addEventListener('click', function(e) {
      if (e.target.tagName === 'A') ul.classList.remove('open');
    });

    // Error indicator badge (populated by error-boundary.js)
    var errorBadge = document.createElement('div');
    errorBadge.id = 'ba-error-indicator';
    errorBadge.title = 'No errors';
    errorBadge.style.display = 'none';
    errorBadge.addEventListener('click', function() {
      var errs = window.__boothappErrors || [];
      if (errs.length === 0) return;
      var last = errs[errs.length - 1];
      alert('Latest error:\n\n' + last.message + '\n\nPage: ' + last.page + '\nTime: ' + last.timestamp);
    });

    right.appendChild(errorBadge);
    right.appendChild(healthDot);
    right.appendChild(hamburger);

    nav.appendChild(logo);
    nav.appendChild(ul);
    nav.appendChild(right);

    return { nav: nav, healthDot: healthDot };
  }

  function pollHealth(dot) {
    function check() {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/health', true);
      xhr.timeout = 5000;
      xhr.onload = function() {
        try {
          var data = JSON.parse(xhr.responseText);
          healthy = data.status === 'ok';
        } catch (e) {
          healthy = false;
        }
        update();
      };
      xhr.onerror = function() { healthy = false; update(); };
      xhr.ontimeout = function() { healthy = false; update(); };
      xhr.send();
    }

    function update() {
      dot.className = 'ba-health ' + (healthy ? 'ok' : 'err');
      dot.title = 'System health: ' + (healthy ? 'healthy' : 'unreachable');
    }

    check();
    setInterval(check, HEALTH_POLL_MS);
  }

  function init() {
    injectStyles();
    var parts = buildNav();
    document.body.insertBefore(parts.nav, document.body.firstChild);
    pollHealth(parts.healthDot);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
