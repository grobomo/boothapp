// CaseyApp Demo Capture -- Content Script
// Tracks all click events with full metadata

let tracking = false;
let sessionId = null;
let sessionStartTime = null;

// --- DOM path builder ---

function getDomPath(element) {
  const path = [];
  let current = element;
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += '#' + current.id;
      path.unshift(selector);
      break; // ID is unique, stop here
    }
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).slice(0, 3);
      if (classes.length > 0 && classes[0] !== '') {
        selector += '.' + classes.join('.');
      }
    }
    // Add nth-child for disambiguation
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += ':nth-child(' + index + ')';
      }
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
}

// --- Element metadata extractor ---

function getElementMetadata(element) {
  const rect = element.getBoundingClientRect();
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    className: (typeof element.className === 'string' ? element.className : '') || null,
    textContent: (element.textContent || '').trim().substring(0, 200),
    href: element.href || element.closest('a')?.href || null,
    type: element.type || null,
    name: element.name || null,
    value: element.tagName === 'INPUT' ? (element.type === 'password' ? '[redacted]' : element.value) : null,
    ariaLabel: element.getAttribute('aria-label') || null,
    role: element.getAttribute('role') || null,
    boundingRect: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  };
}

// --- Click handler ---

function handleClick(event) {
  if (!tracking || !sessionId) return;

  const element = event.target;
  const elapsedMs = Date.now() - sessionStartTime;

  const clickData = {
    timestamp: new Date().toISOString(),
    elapsedMs: elapsedMs,
    coordinates: {
      clientX: event.clientX,
      clientY: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
      screenX: event.screenX,
      screenY: event.screenY
    },
    domPath: getDomPath(element),
    element: getElementMetadata(element),
    pageUrl: window.location.href,
    pageTitle: document.title,
    sessionId: sessionId
  };

  // Send to background for storage
  chrome.runtime.sendMessage({
    type: 'CLICK_EVENT',
    click: clickData
  }).catch(() => {});
}

// --- Message listener ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SESSION_START') {
    sessionId = message.sessionId;
    sessionStartTime = message.startTime;
    tracking = true;
    document.addEventListener('click', handleClick, true);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'SESSION_END') {
    tracking = false;
    document.removeEventListener('click', handleClick, true);
    sessionId = null;
    sessionStartTime = null;
    sendResponse({ ok: true });
    return true;
  }
});

// --- Restore tracking if session was already active ---

chrome.storage.local.get(['sessionActive', 'sessionId', 'sessionStartTime'], (data) => {
  if (data.sessionActive && data.sessionId) {
    sessionId = data.sessionId;
    sessionStartTime = data.sessionStartTime;
    tracking = true;
    document.addEventListener('click', handleClick, true);
  }
});
