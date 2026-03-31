(function() {
  'use strict';

  var errors = [];
  var overlayVisible = false;

  function logError(err) {
    var entry = {
      message: err.message || String(err),
      stack: err.stack || '',
      page: window.location.href,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent
    };
    errors.push(entry);

    // POST to server
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/errors', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(entry));
    } catch (e) {
      // Silent fail -- can't log errors about logging errors
    }

    // Update nav indicator
    updateNavIndicator();
  }

  function updateNavIndicator() {
    var indicator = document.getElementById('ba-error-indicator');
    if (!indicator && errors.length > 0) {
      // Nav may not be built yet; retry on next tick
      setTimeout(updateNavIndicator, 100);
      return;
    }
    if (indicator) {
      indicator.style.display = errors.length > 0 ? 'flex' : 'none';
      indicator.textContent = errors.length;
      indicator.title = errors.length + ' error' + (errors.length !== 1 ? 's' : '') + ' logged';
    }
  }

  function showOverlay(err) {
    if (overlayVisible) return;
    overlayVisible = true;

    var overlay = document.createElement('div');
    overlay.id = 'ba-error-overlay';
    overlay.innerHTML = [
      '<div class="ba-err-box">',
      '  <div class="ba-err-icon">!</div>',
      '  <h2>Something went wrong</h2>',
      '  <p class="ba-err-msg"></p>',
      '  <div class="ba-err-actions">',
      '    <button class="ba-err-retry">Retry</button>',
      '    <button class="ba-err-report">Report Bug</button>',
      '  </div>',
      '  <button class="ba-err-dismiss">Dismiss</button>',
      '</div>'
    ].join('\n');

    overlay.querySelector('.ba-err-msg').textContent =
      (err && err.message) || 'An unexpected error occurred. The page may not work correctly.';

    overlay.querySelector('.ba-err-retry').addEventListener('click', function() {
      window.location.reload();
    });

    overlay.querySelector('.ba-err-report').addEventListener('click', function() {
      var body = 'Error: ' + (err && err.message || 'Unknown') +
        '\nPage: ' + window.location.href +
        '\nTime: ' + new Date().toISOString() +
        '\nStack: ' + (err && err.stack || 'N/A');
      var url = 'https://github.com/altarr/boothapp/issues/new?title=' +
        encodeURIComponent('Bug: ' + (err && err.message || 'JS Error')) +
        '&body=' + encodeURIComponent(body);
      window.open(url, '_blank');
    });

    overlay.querySelector('.ba-err-dismiss').addEventListener('click', function() {
      overlay.remove();
      overlayVisible = false;
    });

    document.body.appendChild(overlay);
  }

  function injectStyles() {
    var css = [
      '#ba-error-overlay { position: fixed; inset: 0; z-index: 99999;',
      '  background: rgba(13,17,23,0.85); backdrop-filter: blur(8px);',
      '  display: flex; align-items: center; justify-content: center;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }',

      '.ba-err-box { background: #161b22; border: 1px solid #30363d; border-radius: 12px;',
      '  padding: 2.5rem; max-width: 480px; width: 90%; text-align: center; color: #e6edf3; }',

      '.ba-err-icon { width: 48px; height: 48px; margin: 0 auto 1rem;',
      '  background: rgba(248,81,73,0.15); border-radius: 50%;',
      '  display: flex; align-items: center; justify-content: center;',
      '  font-size: 1.5rem; font-weight: 700; color: #f85149; }',

      '.ba-err-box h2 { font-size: 1.25rem; margin-bottom: 0.5rem; }',

      '.ba-err-msg { color: #8b949e; font-size: 0.875rem; margin-bottom: 1.5rem;',
      '  word-break: break-word; max-height: 80px; overflow-y: auto; }',

      '.ba-err-actions { display: flex; gap: 0.75rem; justify-content: center; margin-bottom: 1rem; }',

      '.ba-err-retry { background: #238636; color: #fff; border: none; padding: 0.6rem 1.5rem;',
      '  border-radius: 6px; font-size: 0.875rem; font-weight: 600; cursor: pointer; }',
      '.ba-err-retry:hover { background: #2ea043; }',

      '.ba-err-report { background: transparent; color: #58a6ff; border: 1px solid #30363d;',
      '  padding: 0.6rem 1.5rem; border-radius: 6px; font-size: 0.875rem; cursor: pointer; }',
      '.ba-err-report:hover { border-color: #58a6ff; }',

      '.ba-err-dismiss { background: none; border: none; color: #484f58; font-size: 0.75rem;',
      '  cursor: pointer; padding: 0.25rem; }',
      '.ba-err-dismiss:hover { color: #8b949e; }',

      '#ba-error-indicator { display: none; position: absolute; top: 8px;',
      '  width: 18px; height: 18px; border-radius: 50%;',
      '  background: #f85149; color: #fff; font-size: 0.65rem; font-weight: 700;',
      '  align-items: center; justify-content: center; cursor: pointer;',
      '  box-shadow: 0 0 6px rgba(248,81,73,0.5); }'
    ].join('\n');

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Global error handlers ---
  window.onerror = function(message, source, lineno, colno, error) {
    logError({
      message: message,
      stack: error && error.stack ? error.stack : source + ':' + lineno + ':' + colno
    });
    showOverlay({ message: message, stack: error && error.stack });
    return false; // Let browser still log to console
  };

  window.addEventListener('unhandledrejection', function(event) {
    var reason = event.reason || {};
    var msg = reason.message || String(reason) || 'Unhandled promise rejection';
    logError({ message: msg, stack: reason.stack || '' });
    showOverlay({ message: msg, stack: reason.stack });
  });

  // Inject styles immediately
  injectStyles();

  // Expose error count for nav.js to read
  window.__boothappErrors = errors;
})();
