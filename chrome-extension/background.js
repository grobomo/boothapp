// CaseyApp Demo Capture -- Service Worker (Manifest V3)
// Manages screenshot capture timer and session lifecycle

const PACKAGER_URL = 'http://localhost:9222';
const DEFAULT_INTERVAL_MS = 1000;

let captureIntervalId = null;
let sessionStartTime = null;
let sessionId = null;
let intervalMs = DEFAULT_INTERVAL_MS;

// --- Timecode formatting ---

function formatTimecode(elapsedMs) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = elapsedMs % 1000;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const ms = String(millis).padStart(3, '0');
  return `${mm}m${ss}s${ms}`;
}

// --- Screenshot capture ---

async function captureScreenshot() {
  if (!sessionStartTime) return;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;

    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 85
    });

    const elapsedMs = Date.now() - sessionStartTime;
    const timecode = formatTimecode(elapsedMs);
    const filename = `screenshot_${timecode}.jpg`;

    // Convert data URL to blob for POST
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    const formData = new FormData();
    formData.append('screenshot', blob, filename);
    formData.append('sessionId', sessionId);
    formData.append('timecode', timecode);
    formData.append('elapsedMs', String(elapsedMs));
    formData.append('timestamp', new Date().toISOString());

    await fetch(`${PACKAGER_URL}/screenshots`, {
      method: 'POST',
      body: formData
    });
  } catch (err) {
    console.error('[CaseyApp] Screenshot capture error:', err.message);
  }
}

// --- Session lifecycle ---

function startCapture(sid, interval) {
  sessionId = sid;
  intervalMs = interval || DEFAULT_INTERVAL_MS;
  sessionStartTime = Date.now();

  // Clear any existing interval
  if (captureIntervalId) {
    clearInterval(captureIntervalId);
  }

  // Capture immediately, then at interval
  captureScreenshot();
  captureIntervalId = setInterval(captureScreenshot, intervalMs);

  // Notify all content scripts to start click tracking
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SESSION_START',
        sessionId: sid,
        startTime: sessionStartTime
      }).catch(() => {});
    }
  });

  // Store session state for popup
  chrome.storage.local.set({
    sessionActive: true,
    sessionId: sid,
    sessionStartTime: sessionStartTime,
    intervalMs: intervalMs
  });

  return { sessionId: sid, startTime: sessionStartTime };
}

async function stopCapture() {
  if (captureIntervalId) {
    clearInterval(captureIntervalId);
    captureIntervalId = null;
  }

  // Collect clicks from storage and POST to packager
  const data = await chrome.storage.local.get(['clickEvents']);
  const clicks = data.clickEvents || [];

  if (clicks.length > 0) {
    try {
      await fetch(`${PACKAGER_URL}/clicks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          clicks: clicks
        })
      });
    } catch (err) {
      console.error('[CaseyApp] Failed to POST clicks:', err.message);
    }
  }

  // Notify content scripts to stop tracking
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SESSION_END',
        sessionId: sessionId
      }).catch(() => {});
    }
  });

  const endedSessionId = sessionId;
  sessionId = null;
  sessionStartTime = null;

  // Clear stored state
  chrome.storage.local.set({
    sessionActive: false,
    sessionId: null,
    sessionStartTime: null,
    clickEvents: []
  });

  return { sessionId: endedSessionId, clickCount: clicks.length };
}

// --- Message handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_SESSION') {
    const result = startCapture(message.sessionId, message.intervalMs);
    sendResponse(result);
    return true;
  }

  if (message.type === 'STOP_SESSION') {
    stopCapture().then(sendResponse);
    return true; // async response
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({
      active: !!sessionStartTime,
      sessionId: sessionId,
      startTime: sessionStartTime,
      intervalMs: intervalMs,
      elapsed: sessionStartTime ? Date.now() - sessionStartTime : 0
    });
    return true;
  }

  if (message.type === 'CLICK_EVENT') {
    // Append click to local storage
    chrome.storage.local.get(['clickEvents'], (data) => {
      const clicks = data.clickEvents || [];
      clicks.push(message.click);
      chrome.storage.local.set({ clickEvents: clicks });
    });
    return true;
  }

  if (message.type === 'UPDATE_INTERVAL') {
    intervalMs = message.intervalMs;
    if (captureIntervalId && sessionStartTime) {
      clearInterval(captureIntervalId);
      captureIntervalId = setInterval(captureScreenshot, intervalMs);
    }
    chrome.storage.local.set({ intervalMs: intervalMs });
    sendResponse({ intervalMs: intervalMs });
    return true;
  }
});

// --- Restore state on service worker wake ---

chrome.storage.local.get(['sessionActive', 'sessionId', 'sessionStartTime', 'intervalMs'], (data) => {
  if (data.sessionActive && data.sessionStartTime) {
    sessionId = data.sessionId;
    sessionStartTime = data.sessionStartTime;
    intervalMs = data.intervalMs || DEFAULT_INTERVAL_MS;
    captureIntervalId = setInterval(captureScreenshot, intervalMs);
  }
});
