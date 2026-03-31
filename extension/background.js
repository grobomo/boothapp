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

// ─── Pre-signed URL Upload ────────────────────────────────────────────────────
// Uses a Lambda Function URL to get pre-signed S3 PUT URLs instead of
// embedding AWS credentials in the extension for uploads.

async function getPresignedUrl(sessionId, fileType, filename) {
  const { presignEndpoint } = await chrome.storage.local.get(['presignEndpoint']);
  if (!presignEndpoint) {
    throw new Error('Presign endpoint not configured — set presignEndpoint in extension settings');
  }

  const body = { session_id: sessionId, file_type: fileType };
  if (filename) body.filename = filename;

  const response = await fetch(presignEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Presign request failed: ${response.status} ${text}`);
  }

  return response.json(); // { upload_url, key, expires_in }
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

async function s3PutPresigned(sessionId, fileType, body, contentType, filename) {
  const { upload_url } = await getPresignedUrl(sessionId, fileType, filename);

  const bodyBytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const response = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bodyBytes,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`S3 presigned PUT failed: ${response.status} ${text}`);
  }

  return response;
}

// ─── AWS SigV4 Signing (retained for S3 GET polling of active-session.json) ──

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

async function signS3GetRequest(bucket, key, region, credentials) {
  const { awsAccessKeyId, awsSecretAccessKey, awsSessionToken } = credentials;

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d+/, '');

  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${key}`;

  const payloadHash = await sha256Hex(new Uint8Array(0));

  const canonicalHeadersMap = {
    'content-type': 'application/json',
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
    'GET',
    '/' + encodedKey,
    '',
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

  const kDate = await hmacSHA256('AWS4' + awsSecretAccessKey, dateStamp);
  const kRegion = await hmacSHA256(kDate, region);
  const kService = await hmacSHA256(kRegion, 's3');
  const kSigning = await hmacSHA256(kService, 'aws4_request');
  const signature = toHex(await hmacSHA256(kSigning, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${awsAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const fetchHeaders = {
    'content-type': 'application/json',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    'authorization': authorization,
  };
  if (awsSessionToken) {
    fetchHeaders['x-amz-security-token'] = awsSessionToken;
  }

  return { url, headers: fetchHeaders };
}

async function s3GetJson(bucket, key, region, credentials) {
  const { url, headers } = await signS3GetRequest(bucket, key, region, credentials);
  const response = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
  if (!response.ok) return null;
  return response.json();
}

// ─── S3 Session Polling (signed) ─────────────────────────────────────────────

let pollingSessionId = null;
let lastError = '';       // Surfaced to popup as error_message
let lastErrorTime = 0;    // Auto-clear after 30s
let isUploading = false;  // Surfaced to popup as uploading indicator

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
          v1helper_session: {
            active: true,
            session_id: data.session_id,
            visitor_name: data.visitor_name || '',
            start_time: new Date().toISOString(),
            stop_audio: data.stop_audio || false,
          }
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
    lastError = 'S3 Poll Failed';
    lastErrorTime = Date.now();
    // Network error — if tracking, end session
    if (pollingSessionId) {
      pollingSessionId = null;
      chrome.storage.local.set({ v1helper_session: { active: false } });
    }
  }
}

setInterval(pollActiveSession, 2000);

// ─── Session Upload ───────────────────────────────────────────────────────────

async function uploadSessionData(sessionId, clickBuffer) {
  // 30-second timeout for the entire upload
  const deadline = Date.now() + 30_000;

  const screenshots = await getAllScreenshots();

  // Fix screenshot_file paths in clicks buffer (prepend 'screenshots/')
  const buffer = clickBuffer || { session_id: sessionId, events: [] };
  buffer.session_id = sessionId;
  for (const evt of buffer.events) {
    if (evt.screenshot_file && !evt.screenshot_file.startsWith('screenshots/')) {
      evt.screenshot_file = 'screenshots/' + evt.screenshot_file;
    }
  }

  // Upload clicks.json via presigned URL
  const clicksBody = JSON.stringify(buffer, null, 2);
  await s3PutPresigned(sessionId, 'clicks', clicksBody, 'application/json');

  // Upload screenshots in batches of 10 via presigned URLs
  const BATCH_SIZE = 10;
  for (let i = 0; i < screenshots.length; i += BATCH_SIZE) {
    if (Date.now() > deadline) {
      console.warn('V1-Helper: upload timeout reached, stopping at screenshot', i);
      break;
    }
    const batch = screenshots.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (s) => {
      const imgBytes = dataUrlToBytes(s.data_url);
      await s3PutPresigned(sessionId, 'screenshot', imgBytes, 'image/jpeg', s.filename);
    }));
  }

  // Clear local data after upload (success or partial)
  await clearAllScreenshots();
  await chrome.storage.local.remove(['v1helper_clicks']);
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
      sendResponse({ status: 'ok', filename });
    });

    // Ensure periodic timer is running now that the worker is awake
    startPeriodicScreenshots();

    return true; // keep channel open for async sendResponse
  }

  if (message.type === 'session_start') {
    const { session_id, visitor_name } = message;
    lastError = '';
    // Clear previous session data
    Promise.all([
      clearAllScreenshots(),
      chrome.storage.local.remove(['v1helper_clicks']),
      chrome.storage.local.set({
        v1helper_session: {
          active: true,
          session_id,
          visitor_name: visitor_name || '',
          start_time: new Date().toISOString(),
          stop_audio: false,
        }
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

  if (message.type === 'upload_session') {
    const { session_id, click_buffer } = message;
    isUploading = true;
    uploadSessionData(session_id, click_buffer).then(() => {
      lastError = '';
      isUploading = false;
      sendResponse({ status: 'ok' });
    }).catch((err) => {
      console.error('V1-Helper upload failed:', err);
      lastError = 'Upload Failed';
      lastErrorTime = Date.now();
      isUploading = false;
      // Still clear local data even on error
      clearAllScreenshots().catch(() => {});
      chrome.storage.local.remove(['v1helper_clicks']).catch(() => {});
      sendResponse({ status: 'error', error: err.message });
    });
    return true;
  }

  if (message.type === 'test_s3_connection') {
    (async () => {
      try {
        const config = await chrome.storage.local.get([
          's3Bucket', 's3Region', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken'
        ]);
        const { s3Bucket, s3Region, awsAccessKeyId, awsSecretAccessKey, awsSessionToken } = config;
        if (!s3Bucket || !s3Region || !awsAccessKeyId || !awsSecretAccessKey) {
          sendResponse({ connected: false, error: 'Not configured' });
          return;
        }
        const credentials = { awsAccessKeyId, awsSecretAccessKey, awsSessionToken };
        // Try to read active-session.json -- 200 or 404 both mean S3 is reachable
        const body = new Uint8Array(0);
        const { url, headers } = await signS3Request(
          'GET', s3Bucket, 'active-session.json', s3Region, body, 'application/json', credentials
        );
        const response = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
        // 200 = file exists, 404 = file doesn't exist but bucket is accessible
        // 403 = bad credentials, other = network error
        sendResponse({ connected: response.status === 200 || response.status === 404 });
      } catch (err) {
        sendResponse({ connected: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'get_popup_status') {
    (async () => {
      try {
        const store = await chrome.storage.local.get(['v1helper_session', 'v1helper_clicks', 's3Bucket', 'awsAccessKeyId']);
        const session = store.v1helper_session || { active: false };
        const clicks = store.v1helper_clicks || { session_id: '', events: [] };
        const s3Configured = !!(store.s3Bucket && store.awsAccessKeyId);
        const lastEvent = clicks.events.length > 0 ? clicks.events[clicks.events.length - 1] : null;

        // Count screenshots in IndexedDB
        let screenshotCount = 0;
        try {
          const db = await openScreenshotDB();
          screenshotCount = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).count();
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
          });
        } catch (_) {}

        // Auto-clear errors after 30 seconds
        const errorMessage = (lastError && (Date.now() - lastErrorTime < 30000)) ? lastError : '';
        if (!errorMessage) lastError = '';

        sendResponse({
          status: 'ok',
          session_active: !!session.active,
          session_id: session.session_id || '',
          visitor_name: session.visitor_name || '',
          start_time: session.start_time || '',
          click_count: clicks.events.length,
          screenshot_count: screenshotCount,
          last_click_path: lastEvent ? lastEvent.dom_path : '',
          last_click_time: lastEvent ? lastEvent.timestamp : '',
          s3_polling: s3Configured,
          polling_session_id: pollingSessionId || '',
          error_message: errorMessage,
          uploading: isUploading,
        });
      } catch (err) {
        sendResponse({ status: 'error', error: err.message });
      }
    })();
    return true;
  }

  // Default pass-through
  sendResponse({ status: 'ok' });
});
