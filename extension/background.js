// V1-Helper background service worker
// Handles screenshot capture on every click and periodic fallback screenshots.

// ─── IndexedDB ────────────────────────────────────────────────────────────────

const DB_NAME = 'v1helper_screenshots';
const DB_VERSION = 1;
const STORE_NAME = 'screenshots';

function openScreenshotDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('click_index', 'click_index', { unique: false });
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
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ─── IndexedDB Helpers (for upload) ──────────────────────────────────────────

async function getAllScreenshots() {
  const db = await openScreenshotDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function clearAllScreenshots() {
  const db = await openScreenshotDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

// ─── Image Resize ─────────────────────────────────────────────────────────────
// Resize dataURL to fit within maxW x maxH using OffscreenCanvas.
// Returns original dataURL unchanged if already within bounds.

async function resizeIfNeeded(dataUrl, maxW, maxH) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  if (bitmap.width <= maxW && bitmap.height <= maxH) {
    bitmap.close();
    return dataUrl;
  }

  const scale = Math.min(maxW / bitmap.width, maxH / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const resizedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(resizedBlob);
  });
}

// ─── Screenshot Capture ───────────────────────────────────────────────────────

async function captureAndStore({ clickIndex = null, timestamp = null, type = 'click' } = {}) {
  const ts = timestamp || new Date().toISOString();
  const safeTs = ts.replace(/[:.]/g, '-');
  const label = clickIndex != null ? `click${clickIndex}` : 'periodic';
  const filename = `screenshot_${label}_${safeTs}.jpg`;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 });
    const resized = await resizeIfNeeded(dataUrl, 1920, 1080);

    await saveScreenshot({
      click_index: clickIndex,
      timestamp: ts,
      type,
      filename,
      data_url: resized,
    });

    return filename;
  } catch (err) {
    // Tab may not be capturable (e.g. chrome:// pages) — fail silently
    console.warn('V1-Helper screenshot failed:', err.message);
    return null;
  }
}

// ─── Periodic Screenshot (10-second fallback) ─────────────────────────────────
// setInterval keeps firing while the service worker is alive. The worker wakes
// on each click message, so coverage is continuous during active sessions.

let periodicTimer = null;

function startPeriodicScreenshots() {
  if (periodicTimer !== null) return;
  periodicTimer = setInterval(async () => {
    // Only capture periodic screenshots when a session is active
    const { v1helper_session } = await chrome.storage.local.get(['v1helper_session']);
    if (v1helper_session && v1helper_session.active) {
      captureAndStore({ type: 'periodic' });
    }
  }, 10_000);
}

// ─── AWS SigV4 Signing ────────────────────────────────────────────────────────

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(hash));
}

async function hmacSHA256(key, data) {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
  return new Uint8Array(sig);
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function signS3Request(method, bucket, key, region, body, contentType, credentials) {
  const { awsAccessKeyId, awsSecretAccessKey, awsSessionToken } = credentials;

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d+/, '');

  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${key}`;

  const bodyBytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const payloadHash = await sha256Hex(bodyBytes);

  // Canonical headers (sorted, lowercase) — host is NOT sent in fetch headers
  // but must be in canonical headers for signing
  const canonicalHeadersMap = {
    'content-type': contentType,
    'host': host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (awsSessionToken) {
    canonicalHeadersMap['x-amz-security-token'] = awsSessionToken;
  }

  const sortedHeaderKeys = Object.keys(canonicalHeadersMap).sort();
  const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${canonicalHeadersMap[k]}`).join('\n') + '\n';
  const signedHeaders = sortedHeaderKeys.join(';');

  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const canonicalRequest = [
    method,
    '/' + encodedKey,
    '', // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  // Derive signing key
  const kDate = await hmacSHA256('AWS4' + awsSecretAccessKey, dateStamp);
  const kRegion = await hmacSHA256(kDate, region);
  const kService = await hmacSHA256(kRegion, 's3');
  const kSigning = await hmacSHA256(kService, 'aws4_request');
  const signature = toHex(await hmacSHA256(kSigning, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${awsAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // Build fetch headers — omit 'host' (browser sets it automatically)
  const fetchHeaders = {
    'content-type': contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    'authorization': authorization,
  };
  if (awsSessionToken) {
    fetchHeaders['x-amz-security-token'] = awsSessionToken;
  }

  return { url, headers: fetchHeaders, bodyBytes };
}

async function s3Put(bucket, key, region, body, contentType, credentials) {
  const { url, headers, bodyBytes } = await signS3Request(
    'PUT', bucket, key, region, body, contentType, credentials
  );
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: bodyBytes,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`S3 PUT ${key} failed: ${response.status} ${text}`);
  }
  return response;
}

// ─── Signed S3 GET ───────────────────────────────────────────────────────────

async function s3GetJson(bucket, key, region, credentials) {
  const body = new Uint8Array(0);
  const { url, headers } = await signS3Request(
    'GET', bucket, key, region, body, 'application/json', credentials
  );
  const response = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
  if (!response.ok) return null;
  return response.json();
}

// ─── S3 Session Polling (signed) ─────────────────────────────────────────────

let pollingSessionId = null;

async function pollActiveSession() {
  const config = await chrome.storage.local.get([
    's3Bucket', 's3Region', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken'
  ]);
  const { s3Bucket, s3Region, awsAccessKeyId, awsSecretAccessKey, awsSessionToken } = config;
  if (!s3Bucket || !s3Region || !awsAccessKeyId || !awsSecretAccessKey) return;

  const credentials = { awsAccessKeyId, awsSecretAccessKey, awsSessionToken };

  try {
    const data = await s3GetJson(s3Bucket, 'active-session.json', s3Region, credentials);

    if (data && data.active === true) {
      if (!pollingSessionId) {
        pollingSessionId = data.session_id;
        // Notify all content scripts
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'session_state_changed',
              active: true,
              session_id: data.session_id,
              stop_audio: data.stop_audio || false,
            }).catch(() => {});
          }
        });
        // Update local storage
        chrome.storage.local.set({
          v1helper_session: { active: true, session_id: data.session_id, stop_audio: data.stop_audio || false }
        });
      } else if (data.stop_audio !== undefined) {
        // Update stop_audio flag if session is ongoing
        const { v1helper_session } = await chrome.storage.local.get(['v1helper_session']);
        if (v1helper_session && v1helper_session.active) {
          chrome.storage.local.set({
            v1helper_session: { ...v1helper_session, stop_audio: data.stop_audio }
          });
        }
      }
    } else {
      if (pollingSessionId) {
        const endedSessionId = pollingSessionId;
        pollingSessionId = null;
        // Notify all content scripts
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'session_state_changed',
              active: false,
              session_id: endedSessionId,
            }).catch(() => {});
          }
        });
        chrome.storage.local.set({ v1helper_session: { active: false } });
      }
    }
  } catch (_err) {
    // Network error — if tracking, end session
    if (pollingSessionId) {
      pollingSessionId = null;
      chrome.storage.local.set({ v1helper_session: { active: false } });
    }
  }
}

setInterval(pollActiveSession, 2000);

// ─── Upload Retry Queue ───────────────────────────────────────────────────────

const UPLOAD_QUEUE_KEY = 'v1helper_upload_queue';
const RETRY_STATE_KEY = 'v1helper_retry_state';
const MAX_BACKOFF_MS = 30000;

async function getUploadQueue() {
  const result = await chrome.storage.local.get([UPLOAD_QUEUE_KEY]);
  return result[UPLOAD_QUEUE_KEY] || [];
}

async function saveUploadQueue(queue) {
  await chrome.storage.local.set({ [UPLOAD_QUEUE_KEY]: queue });
}

async function getRetryState() {
  const result = await chrome.storage.local.get([RETRY_STATE_KEY]);
  return result[RETRY_STATE_KEY] || { nextRetryTime: 0, attempt: 0 };
}

async function saveRetryState(state) {
  await chrome.storage.local.set({ [RETRY_STATE_KEY]: state });
}

async function enqueueFailedUpload(sessionId, clickBuffer, screenshots) {
  const queue = await getUploadQueue();
  const screenshotData = screenshots.map(s => ({ filename: s.filename, data_url: s.data_url }));
  queue.push({ sessionId, clickBuffer, screenshots: screenshotData, enqueuedAt: Date.now() });
  await saveUploadQueue(queue);
  const retryState = await getRetryState();
  if (retryState.attempt === 0) {
    await saveRetryState({ nextRetryTime: Date.now() + 1000, attempt: 1 });
  }
}

// Upload clicks + screenshots to S3 without side effects (no clearing local data)
async function uploadDirect(sessionId, clickBuffer, screenshots) {
  const config = await chrome.storage.local.get([
    's3Bucket', 's3Region', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken'
  ]);
  const { s3Bucket, s3Region, awsAccessKeyId, awsSecretAccessKey, awsSessionToken } = config;
  if (!s3Bucket || !s3Region || !awsAccessKeyId || !awsSecretAccessKey) {
    throw new Error('S3 credentials not configured');
  }
  const credentials = { awsAccessKeyId, awsSecretAccessKey, awsSessionToken };
  const deadline = Date.now() + 30_000;

  const buffer = clickBuffer || { session_id: sessionId, events: [] };
  buffer.session_id = sessionId;
  for (const evt of buffer.events) {
    if (evt.screenshot_file && !evt.screenshot_file.startsWith('screenshots/')) {
      evt.screenshot_file = 'screenshots/' + evt.screenshot_file;
    }
  }

  const clicksKey = `sessions/${sessionId}/clicks/clicks.json`;
  const clicksBody = JSON.stringify(buffer, null, 2);
  await s3Put(s3Bucket, clicksKey, s3Region, clicksBody, 'application/json', credentials);

  const BATCH_SIZE = 10;
  for (let i = 0; i < screenshots.length; i += BATCH_SIZE) {
    if (Date.now() > deadline) {
      console.warn('V1-Helper: upload timeout reached, stopping at screenshot', i);
      break;
    }
    const batch = screenshots.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (s) => {
      const imgKey = `sessions/${sessionId}/screenshots/${s.filename}`;
      const imgBytes = dataUrlToBytes(s.data_url);
      await s3Put(s3Bucket, imgKey, s3Region, imgBytes, 'image/jpeg', credentials);
    }));
  }
}

// Process one queued upload if the backoff timer has elapsed
async function processRetryQueue() {
  const queue = await getUploadQueue();
  if (queue.length === 0) return;

  const retryState = await getRetryState();
  if (Date.now() < retryState.nextRetryTime) return;

  const item = queue[0];
  try {
    await uploadDirect(item.sessionId, item.clickBuffer, item.screenshots);
    queue.shift();
    await saveUploadQueue(queue);
    if (queue.length === 0) {
      await saveRetryState({ nextRetryTime: 0, attempt: 0 });
    } else {
      await saveRetryState({ nextRetryTime: Date.now() + 1000, attempt: 1 });
    }
  } catch (err) {
    console.warn('V1-Helper: retry failed:', err.message);
    const nextAttempt = retryState.attempt + 1;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
    const delay = Math.min(1000 * Math.pow(2, retryState.attempt), MAX_BACKOFF_MS);
    await saveRetryState({ nextRetryTime: Date.now() + delay, attempt: nextAttempt });
  }
}

// ─── Session Upload ───────────────────────────────────────────────────────────

async function uploadSessionData(sessionId, clickBuffer) {
  const screenshots = await getAllScreenshots();

  try {
    await uploadDirect(sessionId, clickBuffer, screenshots);
    // Success -- clear local data
    await clearAllScreenshots();
    await chrome.storage.local.remove(['v1helper_clicks']);
    // Drain queued retries in the background
    processRetryQueue().catch(() => {});
  } catch (err) {
    console.error('V1-Helper upload failed, queuing for retry:', err.message);
    await enqueueFailedUpload(sessionId, clickBuffer, screenshots);
    // Data is preserved in the queue, safe to clear working copies
    await clearAllScreenshots();
    await chrome.storage.local.remove(['v1helper_clicks']);
    throw err;
  }
}

// ─── Keepalive Port ───────────────────────────────────────────────────────────

let keepalivePort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'session-keepalive') {
    keepalivePort = port;
    port.onDisconnect.addListener(() => {
      if (keepalivePort === port) keepalivePort = null;
    });
    // No-op: just accepting the connection keeps the service worker alive
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('V1-Helper installed');
  startPeriodicScreenshots();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'click_event') {
    const { index, timestamp } = message.event;

    captureAndStore({ clickIndex: index, timestamp }).then((filename) => {
      // Try to drain retry queue on each click (best-effort)
      processRetryQueue().catch(() => {});
      sendResponse({ status: 'ok', filename });
    });

    // Ensure periodic timer is running now that the worker is awake
    startPeriodicScreenshots();

    return true; // keep channel open for async sendResponse
  }

  if (message.type === 'session_start') {
    const { session_id } = message;
    // Clear previous session data
    Promise.all([
      clearAllScreenshots(),
      chrome.storage.local.remove(['v1helper_clicks']),
      chrome.storage.local.set({
        v1helper_session: { active: true, session_id, stop_audio: false }
      }),
    ]).then(() => {
      sendResponse({ status: 'ok' });
    }).catch((err) => {
      sendResponse({ status: 'error', error: err.message });
    });
    return true;
  }

  if (message.type === 'session_end') {
    chrome.storage.local.set({ v1helper_session: { active: false } }).then(() => {
      sendResponse({ status: 'ok' });
    });
    return true;
  }

  if (message.type === 'get_clicks') {
    chrome.storage.local.get(['v1helper_clicks'], (result) => {
      const buffer = result.v1helper_clicks || { session_id: '', events: [] };
      sendResponse({ status: 'ok', buffer });
    });
    return true;
  }

  if (message.type === 'get_screenshot_count') {
    getAllScreenshots().then((screenshots) => {
      sendResponse({ status: 'ok', count: screenshots.length });
    }).catch(() => {
      sendResponse({ status: 'ok', count: 0 });
    });
    return true;
  }

  if (message.type === 'upload_session') {
    const { session_id, click_buffer } = message;
    uploadSessionData(session_id, click_buffer).then(() => {
      sendResponse({ status: 'ok' });
    }).catch((err) => {
      console.error('V1-Helper upload failed:', err);
      // Data is already queued for retry by uploadSessionData
      sendResponse({ status: 'queued', error: err.message });
    });
    return true;
  }

  if (message.type === 'get_queue_status') {
    getUploadQueue().then((queue) => {
      sendResponse({ status: 'ok', queueLength: queue.length });
    }).catch(() => {
      sendResponse({ status: 'ok', queueLength: 0 });
    });
    return true;
  }

  // Default pass-through
  sendResponse({ status: 'ok' });
});
