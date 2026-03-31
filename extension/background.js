// CaseyApp Background Service Worker
// Handles screenshot capture, click storage, and session lifecycle

// ---- IndexedDB for screenshots ----

const DB_NAME = 'caseyapp_screenshots';
const DB_VERSION = 1;
const STORE_NAME = 'screenshots';

function openScreenshotDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function saveScreenshot(record) {
  const db = await openScreenshotDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add(record);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getScreenshotCount() {
  const db = await openScreenshotDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => resolve(0);
  });
}

async function getAllScreenshots() {
  const db = await openScreenshotDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => resolve([]);
  });
}

async function clearScreenshots() {
  const db = await openScreenshotDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// ---- Screenshot Capture ----

async function captureScreenshot(opts) {
  const ts = opts.timestamp || new Date().toISOString();
  const elapsed = opts.elapsedMs || 0;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  const ms = elapsed % 1000;
  const timecode = `${String(mins).padStart(2, '0')}m${String(secs).padStart(2, '0')}s${String(ms).padStart(3, '0')}`;
  const filename = `screenshot_${timecode}.jpg`;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 });
    await saveScreenshot({ timestamp: ts, filename, data_url: dataUrl, type: opts.type || 'periodic' });
    return filename;
  } catch (err) {
    console.warn('CaseyApp screenshot failed:', err.message);
    return null;
  }
}

// ---- Periodic Screenshot Timer ----

let periodicTimer = null;
let sessionStartTime = null;

function startPeriodicCapture() {
  if (periodicTimer) return;
  periodicTimer = setInterval(async () => {
    const { caseyapp_session } = await chrome.storage.local.get(['caseyapp_session']);
    if (caseyapp_session && caseyapp_session.active && sessionStartTime) {
      const elapsed = Date.now() - sessionStartTime;
      captureScreenshot({ elapsedMs: elapsed, type: 'periodic' });
    }
  }, 1000); // every 1 second per spec
}

function stopPeriodicCapture() {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}

// ---- POST clicks to packager ----

async function postClicksToPackager(clickBuffer) {
  try {
    await fetch('http://localhost:9222/clicks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clickBuffer),
    });
  } catch (_) {
    // Packager may not be running -- clicks are still in storage
  }
}

// ---- Message Handler ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'click_event') {
    const { index, timestamp } = message.event;
    const elapsed = sessionStartTime ? Date.now() - sessionStartTime : 0;
    captureScreenshot({ elapsedMs: elapsed, type: 'click' }).then((filename) => {
      sendResponse({ status: 'ok', filename });
    });
    startPeriodicCapture();
    return true;
  }

  if (message.type === 'session_start') {
    sessionStartTime = Date.now();
    Promise.all([
      clearScreenshots(),
      chrome.storage.local.remove(['caseyapp_clicks']),
      chrome.storage.local.set({
        caseyapp_session: { active: true, session_id: message.session_id }
      }),
    ]).then(() => {
      startPeriodicCapture();
      sendResponse({ status: 'ok' });
    });
    return true;
  }

  if (message.type === 'session_end') {
    stopPeriodicCapture();
    sessionStartTime = null;
    chrome.storage.local.get(['caseyapp_clicks'], (result) => {
      const clicks = result.caseyapp_clicks || { events: [] };
      postClicksToPackager(clicks);
    });
    chrome.storage.local.set({ caseyapp_session: { active: false } }).then(() => {
      sendResponse({ status: 'ok' });
    });
    return true;
  }

  if (message.type === 'get_screenshot_count') {
    getScreenshotCount().then((count) => {
      sendResponse({ count });
    });
    return true;
  }

  sendResponse({ status: 'ok' });
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('CaseyApp Demo Capture installed');
});
