// CaseyApp Popup Controller
// Handles registration, QR generation, and session monitoring

const STORAGE_KEYS = ['managementUrl', 'demoPcId', 'demoPcName', 'eventId', 'eventName', 'registered'];

// DOM refs
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const errorMsg = document.getElementById('errorMsg');
const setupSection = document.getElementById('setupSection');
const eventInfo = document.getElementById('eventInfo');
const qrSection = document.getElementById('qrSection');
const qrImage = document.getElementById('qrImage');
const sessionBar = document.getElementById('sessionBar');
const sessionIndicator = document.getElementById('sessionIndicator');
const sessionLabel = document.getElementById('sessionLabel');
const counters = document.getElementById('counters');
const clickCountEl = document.getElementById('clickCount');
const screenshotCountEl = document.getElementById('screenshotCount');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');

// ---- Connection Status ----

function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.className = 'status-text ' + state;
  statusText.textContent = text;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
}

// ---- View Toggle ----

function showSetup() {
  setupSection.classList.remove('hidden');
  eventInfo.classList.add('hidden');
  qrSection.classList.add('hidden');
  sessionBar.classList.add('hidden');
  counters.classList.add('hidden');
}

function showRegistered(config) {
  setupSection.classList.add('hidden');
  eventInfo.classList.remove('hidden');
  qrSection.classList.remove('hidden');
  sessionBar.classList.remove('hidden');
  counters.classList.remove('hidden');

  document.getElementById('eventName').textContent = config.eventName || 'Event';
  document.getElementById('eventDetail').textContent = 'Event ID: ' + (config.eventId || '-');
  document.getElementById('demoPcBadge').textContent = config.demoPcName || config.demoPcId;

  // Settings panel info
  document.getElementById('settingsServerUrl').value = config.managementUrl || '';
  document.getElementById('settingsDemoPcId').value = config.demoPcId || '';
}

// ---- Registration Flow ----

document.getElementById('registerBtn').addEventListener('click', async () => {
  hideError();
  const serverUrl = document.getElementById('serverUrl').value.trim().replace(/\/$/, '');
  const pcName = document.getElementById('pcName').value.trim();

  if (!serverUrl) { showError('Server URL is required'); return; }
  if (!pcName) { showError('Demo PC name is required'); return; }

  const btn = document.getElementById('registerBtn');
  btn.disabled = true;
  btn.textContent = 'CONNECTING...';
  setStatus('connecting', 'Connecting...');

  try {
    // Save management URL first so API client can use it
    await chrome.storage.local.set({ managementUrl: serverUrl });

    // 1. Get active event
    const event = await ManagementAPI.getActiveEvent();
    if (!event || !event.id) throw new Error('No active event on server');

    // 2. Register demo PC
    const demoPC = await ManagementAPI.registerDemoPC(pcName);
    const demoPcId = demoPC.id || demoPC.name || pcName;

    // 3. Fetch QR payload
    const qrPayload = await ManagementAPI.getQRPayload(demoPcId);

    // 4. Generate branded QR code
    const qrDataUrl = await QRGenerator.generate(qrPayload);
    qrImage.src = qrDataUrl;

    // 5. Save registration
    const config = {
      managementUrl: serverUrl,
      demoPcId: demoPcId,
      demoPcName: pcName,
      eventId: event.id,
      eventName: event.name || 'Event',
      registered: true,
    };
    await chrome.storage.local.set(config);

    setStatus('connected', 'Connected -- ' + (event.name || 'Active Event'));
    showRegistered(config);

  } catch (err) {
    setStatus('disconnected', 'Connection failed');
    showError(err.message);
    btn.disabled = false;
    btn.textContent = 'REGISTER & GENERATE QR';
  }
});

// ---- Disconnect ----

document.getElementById('disconnectBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(STORAGE_KEYS);
  setStatus('disconnected', 'Not connected');
  showSetup();
  settingsPanel.classList.remove('open');
  settingsBtn.classList.remove('active');
});

// ---- Settings Toggle ----

settingsBtn.addEventListener('click', () => {
  const isOpen = settingsPanel.classList.toggle('open');
  settingsBtn.classList.toggle('active', isOpen);
});

// ---- Session Monitoring ----

function updateSessionState() {
  chrome.storage.local.get(['caseyapp_session'], (result) => {
    const session = result.caseyapp_session;
    if (session && session.active) {
      sessionIndicator.className = 'session-indicator recording';
      sessionLabel.className = 'session-label recording';
      sessionLabel.textContent = 'Recording -- ' + (session.session_id || '');
    } else {
      sessionIndicator.className = 'session-indicator idle';
      sessionLabel.className = 'session-label idle';
      sessionLabel.textContent = 'Idle -- waiting for session';
    }
  });
}

function updateCounters() {
  chrome.runtime.sendMessage({ type: 'get_screenshot_count' }, (response) => {
    if (response && typeof response.count === 'number') {
      screenshotCountEl.textContent = response.count;
    }
  });
  chrome.storage.local.get(['caseyapp_clicks'], (result) => {
    const buffer = result.caseyapp_clicks;
    clickCountEl.textContent = (buffer && buffer.events) ? buffer.events.length : '0';
  });
}

// ---- Init ----

chrome.storage.local.get(STORAGE_KEYS, async (config) => {
  if (config.registered) {
    showRegistered(config);

    // Re-generate QR from server (always fresh)
    try {
      setStatus('connecting', 'Connecting...');
      const qrPayload = await ManagementAPI.getQRPayload(config.demoPcId);
      const qrDataUrl = await QRGenerator.generate(qrPayload);
      qrImage.src = qrDataUrl;
      setStatus('connected', 'Connected -- ' + (config.eventName || 'Event'));
    } catch (err) {
      setStatus('disconnected', 'Server unreachable');
      showError('Could not refresh QR: ' + err.message);
    }

    updateSessionState();
    updateCounters();
    setInterval(updateSessionState, 2000);
    setInterval(updateCounters, 2000);
  } else {
    showSetup();
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.caseyapp_session) {
    updateSessionState();
  }
});
