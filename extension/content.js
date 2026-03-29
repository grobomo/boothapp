// V1-Helper content script
// Handles click interception, DOM path capture, and local storage buffering.

console.log('V1-Helper content script loaded on:', window.location.hostname);

// ─── DOM Path Builder ────────────────────────────────────────────────────────

/**
 * Build a CSS selector path from a DOM element up to the root.
 * Produces a unique, readable path like: div.app-content > nav > a.endpoint-security
 */
function buildDomPath(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    let selector = node.tagName.toLowerCase();
    if (node.id) {
      selector += '#' + node.id;
      parts.unshift(selector);
      break; // ID is unique enough — stop here
    }
    const classes = Array.from(node.classList)
      .filter(c => c.length > 0)
      .slice(0, 3) // cap at 3 classes to keep path readable
      .join('.');
    if (classes) {
      selector += '.' + classes;
    }
    parts.unshift(selector);
    node = node.parentElement;
    // Stop after 6 levels to keep paths concise
    if (parts.length >= 6) break;
  }
  return parts.join(' > ');
}

// ─── Element Info Extractor ──────────────────────────────────────────────────

function extractElementInfo(el) {
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    class: el.className || '',
    text: (el.innerText || el.textContent || '').trim().slice(0, 100),
    href: el.href || el.getAttribute('href') || '',
  };
}

// ─── Storage Helpers ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'v1helper_clicks';

/**
 * Load the current click buffer from chrome.storage.local.
 * Returns { session_id, events } or null if nothing stored yet.
 */
function loadClickBuffer(callback) {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    callback(result[STORAGE_KEY] || null);
  });
}

/**
 * Persist the click buffer back to chrome.storage.local.
 */
function saveClickBuffer(buffer) {
  chrome.storage.local.set({ [STORAGE_KEY]: buffer });
}

// ─── Session State Helper ─────────────────────────────────────────────────────

function getSessionState(cb) {
  chrome.storage.local.get(['v1helper_session'], r => cb(r.v1helper_session || { active: false }));
}

// ─── Click Handler ────────────────────────────────────────────────────────────

let eventIndex = 0;

function handleClick(event) {
  // Gate: only record clicks when a session is active
  getSessionState((session) => {
    if (!session.active) return;

    const el = event.target;
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

    const timestamp = new Date().toISOString();
    const domPath = buildDomPath(el);
    const element = extractElementInfo(el);

    // Resolve page URL/title — inside iframes these differ from the top frame
    let pageUrl, pageTitle;
    try {
      pageUrl = window.location.href;
      pageTitle = window.document.title;
    } catch (_) {
      // Cross-origin iframe: fall back to what we can access
      pageUrl = document.referrer || window.location.href;
      pageTitle = '';
    }

    const clickEvent = {
      index: null, // assigned after loading buffer
      timestamp,
      type: 'click',
      dom_path: domPath,
      element,
      coordinates: { x: event.clientX, y: event.clientY },
      page_url: pageUrl,
      page_title: pageTitle,
      screenshot_file: null, // populated by screenshot workstream
    };

    loadClickBuffer((buffer) => {
      if (!buffer) {
        buffer = { session_id: session.session_id || '', events: [] };
      }
      clickEvent.index = buffer.events.length + 1;
      buffer.events.push(clickEvent);
      saveClickBuffer(buffer);

      // Notify background service worker — it captures a screenshot and returns
      // the filename so we can backfill screenshot_file on the stored event.
      chrome.runtime.sendMessage({
        type: 'click_event',
        event: clickEvent,
      }).then((response) => {
        if (response && response.filename) {
          loadClickBuffer((buf) => {
            if (!buf) return;
            const evt = buf.events.find(e => e.index === clickEvent.index);
            if (evt) {
              evt.screenshot_file = response.filename;
              saveClickBuffer(buf);
            }
          });
        }
      }).catch(() => {
        // Background may not be listening yet — silently ignore
      });
    });
  });
}

// ─── Attach Listener ──────────────────────────────────────────────────────────
// Use capture phase (true) so we intercept clicks on all elements including
// those with stopPropagation, and so this works inside iframes.

document.addEventListener('click', handleClick, true);

// ─── Top-frame only: Banner, S3 Polling, Session Lifecycle ───────────────────

if (window === window.top) {

  // ─── Banner ─────────────────────────────────────────────────────────────────

  let bannerEl = null;
  let dismissedBanner = false;

  function showBanner() {
    if (dismissedBanner) return;
    if (bannerEl) {
      bannerEl.style.display = 'flex';
      return;
    }

    bannerEl = document.createElement('div');
    bannerEl.id = 'v1helper-session-banner';
    bannerEl.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'right: 0',
      'z-index: 2147483647',
      'background: #1a1a2e',
      'color: #a78bfa',
      'font-size: 13px',
      'font-family: system-ui, sans-serif',
      'padding: 8px 16px',
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'box-shadow: 0 2px 6px rgba(0,0,0,0.4)',
    ].join(';');

    const text = document.createElement('span');
    text.textContent = 'This session is tracked — you will receive a summary';

    const dismiss = document.createElement('button');
    dismiss.textContent = '✕';
    dismiss.style.cssText = [
      'background: none',
      'border: none',
      'color: #a78bfa',
      'cursor: pointer',
      'font-size: 14px',
      'padding: 0 4px',
      'margin-left: 12px',
      'line-height: 1',
    ].join(';');
    dismiss.addEventListener('click', () => {
      dismissedBanner = true;
      hideBanner();
    });

    bannerEl.appendChild(text);
    bannerEl.appendChild(dismiss);
    document.documentElement.appendChild(bannerEl);
  }

  function hideBanner() {
    if (bannerEl) {
      bannerEl.remove();
      bannerEl = null;
    }
  }

  // ─── Session lifecycle variables ─────────────────────────────────────────────

  let trackingSessionId = null;
  let uploadInProgress = false;

  // ─── Session Lifecycle ───────────────────────────────────────────────────────

  function onSessionStart(sessionId) {
    trackingSessionId = sessionId;
    dismissedBanner = false; // reset dismiss flag for new session
    showBanner();
    chrome.runtime.sendMessage({ type: 'session_start', session_id: sessionId }).catch(() => {});
  }

  function onSessionEnd() {
    if (uploadInProgress) return; // guard against double-call
    if (!trackingSessionId) return;

    const sessionId = trackingSessionId;
    trackingSessionId = null;
    hideBanner();
    uploadInProgress = true;

    // Get click buffer then trigger upload in background
    chrome.runtime.sendMessage({ type: 'get_clicks' }).then((response) => {
      const clickBuffer = (response && response.buffer) || { session_id: sessionId, events: [] };
      return chrome.runtime.sendMessage({
        type: 'upload_session',
        session_id: sessionId,
        click_buffer: clickBuffer,
      });
    }).then(() => {
      uploadInProgress = false;
    }).catch((err) => {
      console.warn('V1-Helper: upload failed:', err);
      uploadInProgress = false;
    });

    // Signal background that session is over (stops periodic screenshots)
    chrome.runtime.sendMessage({ type: 'session_end' }).catch(() => {});
  }

  // ─── S3 Session Polling ──────────────────────────────────────────────────────

  async function pollForSession() {
    const config = await new Promise(resolve =>
      chrome.storage.local.get(['s3Bucket', 's3Region'], resolve)
    );
    const { s3Bucket, s3Region } = config;

    // No-op if S3 not configured
    if (!s3Bucket || !s3Region) return;

    const url = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/active-session.json`;

    try {
      const resp = await fetch(url, { cache: 'no-store' });

      if (resp.ok) {
        const data = await resp.json();

        // Store stop_audio in session state if present
        if (trackingSessionId && data.stop_audio !== undefined) {
          const { v1helper_session } = await new Promise(resolve =>
            chrome.storage.local.get(['v1helper_session'], resolve)
          );
          if (v1helper_session && v1helper_session.active) {
            await new Promise(resolve =>
              chrome.storage.local.set({
                v1helper_session: { ...v1helper_session, stop_audio: data.stop_audio }
              }, resolve)
            );
          }
        }

        if (data.status === 'active') {
          if (!trackingSessionId) {
            onSessionStart(data.session_id);
          }
        } else {
          if (trackingSessionId) {
            onSessionEnd();
          }
        }
      } else {
        // Non-200 while tracking: end session
        if (trackingSessionId) {
          onSessionEnd();
        }
      }
    } catch (_err) {
      // Network error while tracking: end session
      if (trackingSessionId) {
        onSessionEnd();
      }
    }
  }

  setInterval(pollForSession, 2000);

  // ─── Background keepalive port ────────────────────────────────────────────────

  function connectKeepalive() {
    try {
      const port = chrome.runtime.connect({ name: 'session-keepalive' });
      port.onDisconnect.addListener(() => {
        setTimeout(connectKeepalive, 1000);
      });
    } catch (_) {
      setTimeout(connectKeepalive, 1000);
    }
  }

  connectKeepalive();

} // end top-frame only

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get_clicks') {
    loadClickBuffer((buffer) => {
      sendResponse({ status: 'ok', buffer: buffer || { session_id: '', events: [] } });
    });
    return true; // keep channel open for async sendResponse
  }

  if (message.type === 'set_session_id') {
    loadClickBuffer((buffer) => {
      if (!buffer) buffer = { session_id: '', events: [] };
      buffer.session_id = message.session_id;
      saveClickBuffer(buffer);
      sendResponse({ status: 'ok' });
    });
    return true;
  }

  if (message.type === 'clear_clicks') {
    chrome.storage.local.remove([STORAGE_KEY], () => {
      sendResponse({ status: 'ok' });
    });
    return true;
  }

  if (message.type === 'session_state_changed') {
    // Iframes receive this to update their awareness of session state
    // The actual tracking gate reads from chrome.storage.local via getSessionState()
    // so no local variable update needed — just acknowledge
    sendResponse({ status: 'ok' });
    return true;
  }

  // Default: pass-through for other message types
  console.log('V1-Helper content received message:', message);
  sendResponse({ status: 'ok', url: window.location.href });
});
