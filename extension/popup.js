// ─── V1-Helper Popup ──────────────────────────────────────────────────────────

const S3_KEYS = ['s3Bucket', 's3Region', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken'];

// ─── DOM References ───────────────────────────────────────────────────────────

const sessionIndicator = document.getElementById('sessionIndicator');
const sessionLabel = document.getElementById('sessionLabel');
const sessionIdEl = document.getElementById('sessionId');
const clickCountEl = document.getElementById('clickCount');
const screenshotCountEl = document.getElementById('screenshotCount');
const s3Dot = document.getElementById('s3Dot');
const s3StatusText = document.getElementById('s3StatusText');
const demoActions = document.getElementById('demoActions');
const startDemoBtn = document.getElementById('startDemoBtn');
const endDemoBtn = document.getElementById('endDemoBtn');
const settingsBtn = document.getElementById('settingsBtn');
const s3Config = document.getElementById('s3Config');
const queueWarning = document.getElementById('queueWarning');
const queueWarningText = document.getElementById('queueWarningText');

// ─── Session Status ───────────────────────────────────────────────────────────

// States: idle, recording, uploading, complete
let currentSessionState = 'idle';

function setSessionState(state, sessionId) {
  currentSessionState = state;

  // Remove all state classes
  sessionIndicator.className = 'session-indicator ' + state;
  sessionLabel.className = 'session-label ' + state;

  switch (state) {
    case 'idle':
      sessionLabel.textContent = 'Idle';
      sessionIdEl.textContent = '';
      break;
    case 'recording':
      sessionLabel.textContent = 'Recording';
      sessionIdEl.textContent = sessionId || '';
      break;
    case 'uploading':
      sessionLabel.textContent = 'Uploading...';
      sessionIdEl.textContent = sessionId || '';
      break;
    case 'complete':
      sessionLabel.textContent = 'Complete \u2713';
      sessionIdEl.textContent = sessionId || '';
      break;
  }

  updateDemoButtons();
}

function updateDemoButtons() {
  const isRecording = currentSessionState === 'recording';
  startDemoBtn.disabled = isRecording;
  endDemoBtn.disabled = !isRecording;
}

// ─── Counters ─────────────────────────────────────────────────────────────────

function updateCounters() {
  chrome.storage.local.get(['v1helper_clicks'], (result) => {
    const buffer = result.v1helper_clicks;
    if (buffer && buffer.events) {
      clickCountEl.textContent = buffer.events.length;
    } else {
      clickCountEl.textContent = '0';
    }
  });

  // Screenshot count from IndexedDB via background
  chrome.runtime.sendMessage({ type: 'get_screenshot_count' }, (response) => {
    if (response && typeof response.count === 'number') {
      screenshotCountEl.textContent = response.count;
    } else {
      // Fallback: use click count as approximate screenshot count
      screenshotCountEl.textContent = clickCountEl.textContent;
    }
  });
}

// ─── Queue Status ─────────────────────────────────────────────────────────────

function updateQueueStatus() {
  chrome.runtime.sendMessage({ type: 'get_queue_status' }, (response) => {
    if (response && response.queueLength > 0) {
      const n = response.queueLength;
      queueWarningText.textContent = n + ' upload' + (n > 1 ? 's' : '') + ' queued for retry';
      queueWarning.classList.add('visible');
    } else {
      queueWarning.classList.remove('visible');
    }
  });
}

// Poll counters and queue status while popup is open
updateCounters();
updateQueueStatus();
const counterInterval = setInterval(() => {
  updateCounters();
  updateQueueStatus();
}, 2000);

// ─── S3 Config Status ─────────────────────────────────────────────────────────

function isS3Configured(config) {
  return !!(config.s3Bucket && config.s3Region && config.awsAccessKeyId && config.awsSecretAccessKey);
}

function updateS3Status(config) {
  const configured = isS3Configured(config);

  s3Dot.className = 's3-dot ' + (configured ? 'connected' : 'disconnected');
  s3StatusText.className = 's3-status-text ' + (configured ? 'connected' : 'disconnected');
  s3StatusText.textContent = configured
    ? 'S3 Connected \u2014 ' + config.s3Bucket
    : 'S3 Not Configured';

  // Show/hide demo buttons based on S3 config
  if (configured) {
    demoActions.classList.remove('hidden');
  } else {
    demoActions.classList.add('hidden');
  }
}

// ─── Load Session State ───────────────────────────────────────────────────────

function loadSessionState() {
  chrome.storage.local.get(['v1helper_session'], (result) => {
    const session = result.v1helper_session;
    if (session && session.active && session.session_id) {
      setSessionState('recording', session.session_id);
    } else {
      setSessionState('idle');
    }
  });
}

loadSessionState();

// ─── Load S3 Config ───────────────────────────────────────────────────────────

chrome.storage.local.get(S3_KEYS, (config) => {
  if (config.s3Bucket) document.getElementById('s3Bucket').value = config.s3Bucket;
  if (config.s3Region) document.getElementById('s3Region').value = config.s3Region;
  if (config.awsAccessKeyId) document.getElementById('awsAccessKeyId').value = config.awsAccessKeyId;
  if (config.awsSecretAccessKey) document.getElementById('awsSecretAccessKey').value = config.awsSecretAccessKey;
  if (config.awsSessionToken) document.getElementById('awsSessionToken').value = config.awsSessionToken;
  updateS3Status(config);
});

// ─── Settings Toggle ──────────────────────────────────────────────────────────

settingsBtn.addEventListener('click', () => {
  const isOpen = s3Config.classList.toggle('open');
  settingsBtn.classList.toggle('active', isOpen);
});

// ─── Save S3 Config ───────────────────────────────────────────────────────────

document.getElementById('s3SaveBtn').addEventListener('click', () => {
  const config = {
    s3Bucket: document.getElementById('s3Bucket').value.trim(),
    s3Region: document.getElementById('s3Region').value.trim(),
    awsAccessKeyId: document.getElementById('awsAccessKeyId').value.trim(),
    awsSecretAccessKey: document.getElementById('awsSecretAccessKey').value.trim(),
    awsSessionToken: document.getElementById('awsSessionToken').value.trim(),
  };
  chrome.storage.local.set(config, () => {
    updateS3Status(config);
    const btn = document.getElementById('s3SaveBtn');
    const orig = btn.textContent;
    btn.textContent = 'Saved \u2713';
    btn.classList.add('saved');
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('saved');
    }, 1500);
  });
});

// ─── Pre-fill Demo ────────────────────────────────────────────────────────────

document.getElementById('s3DemoBtn').addEventListener('click', () => {
  document.getElementById('s3Bucket').value = 'boothapp-sessions-752266476357';
  document.getElementById('s3Region').value = 'us-east-1';
});

// ─── Start Demo ───────────────────────────────────────────────────────────────

startDemoBtn.addEventListener('click', () => {
  chrome.storage.local.get(S3_KEYS, (config) => {
    if (!isS3Configured(config)) return;

    const sessionId = 'demo-' + Date.now();
    setSessionState('recording', sessionId);

    // Signal background to start session
    chrome.runtime.sendMessage({
      type: 'session_start',
      session_id: sessionId,
    });

    // Write active-session.json to S3 so watcher picks it up
    chrome.runtime.sendMessage({
      type: 'write_active_session',
      session_id: sessionId,
      active: true,
    });
  });
});

// ─── End Demo ─────────────────────────────────────────────────────────────────

endDemoBtn.addEventListener('click', () => {
  const sessionId = sessionIdEl.textContent;
  setSessionState('uploading', sessionId);

  // Signal background to end and upload
  chrome.runtime.sendMessage({ type: 'session_end' }, () => {
    chrome.storage.local.get(['v1helper_clicks'], (result) => {
      const clickBuffer = result.v1helper_clicks || { session_id: sessionId, events: [] };
      chrome.runtime.sendMessage({
        type: 'upload_session',
        session_id: sessionId,
        click_buffer: clickBuffer,
      }, (response) => {
        if (response && response.status === 'ok') {
          setSessionState('complete', sessionId);
          clickCountEl.textContent = '0';
          screenshotCountEl.textContent = '0';
          // Deactivate active-session.json
          chrome.runtime.sendMessage({
            type: 'write_active_session',
            session_id: sessionId,
            active: false,
          });
          // Return to idle after 3s
          setTimeout(() => setSessionState('idle'), 3000);
        } else if (response && response.status === 'queued') {
          // Upload failed but data is queued for retry
          setSessionState('idle');
          updateQueueStatus();
        } else {
          setSessionState('idle');
        }
      });
    });
  });
});

// ─── Listen for storage changes (session state from background) ───────────────

chrome.storage.onChanged.addListener((changes) => {
  if (changes.v1helper_upload_queue) {
    updateQueueStatus();
  }
  if (changes.v1helper_session) {
    const session = changes.v1helper_session.newValue;
    if (session && session.active) {
      // Only switch to recording if we're not in uploading/complete state
      if (currentSessionState !== 'uploading' && currentSessionState !== 'complete') {
        setSessionState('recording', session.session_id);
      }
    } else if (currentSessionState === 'recording') {
      setSessionState('idle');
    }
  }
});
