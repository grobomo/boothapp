// V1-Helper Popup
// Session states: idle (gray), active (green), uploading (blue), error (red), complete (green)

const S3_KEYS = ['s3Bucket', 's3Region', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken'];

// -- DOM References --

const sessionIndicator = document.getElementById('sessionIndicator');
const sessionLabel = document.getElementById('sessionLabel');
const sessionIdEl = document.getElementById('sessionId');
const clickCountEl = document.getElementById('clickCount');
const screenshotCountEl = document.getElementById('screenshotCount');
const s3Dot = document.getElementById('s3Dot');
const s3StatusText = document.getElementById('s3StatusText');
const startSessionBtn = document.getElementById('startSessionBtn');
const stopSessionBtn = document.getElementById('stopSessionBtn');
const settingsBtn = document.getElementById('settingsBtn');
const s3Config = document.getElementById('s3Config');

// -- Session State Management --

let currentSessionState = 'idle';

function setSessionState(state, sessionId) {
  currentSessionState = state;

  sessionIndicator.className = 'session-indicator ' + state;
  sessionLabel.className = 'session-label ' + state;

  var labels = {
    idle: 'Idle',
    active: 'Recording',
    uploading: 'Uploading...',
    error: 'Error',
    complete: 'Complete'
  };

  sessionLabel.textContent = labels[state] || state;
  sessionIdEl.textContent = sessionId || '';

  // Persist state to chrome.storage so it survives popup close/reopen
  chrome.storage.local.set({
    v1helper_popup_state: { state: state, sessionId: sessionId || '' }
  });

  updateSessionButtons();
}

function updateSessionButtons() {
  var isActive = currentSessionState === 'active';
  var isUploading = currentSessionState === 'uploading';

  startSessionBtn.disabled = isActive || isUploading;
  stopSessionBtn.disabled = !isActive;
}

// -- Counter Updates --

function updateCounters() {
  chrome.storage.local.get(['v1helper_clicks'], function(result) {
    var buffer = result.v1helper_clicks;
    clickCountEl.textContent = (buffer && buffer.events) ? buffer.events.length : '0';
  });

  chrome.runtime.sendMessage({ type: 'get_screenshot_count' }, function(response) {
    if (chrome.runtime.lastError) {
      // Background not ready yet
      return;
    }
    if (response && typeof response.count === 'number') {
      screenshotCountEl.textContent = response.count;
    }
  });
}

updateCounters();
var counterInterval = setInterval(updateCounters, 2000);

// -- S3 Config Status --

function isS3Configured(config) {
  return !!(config.s3Bucket && config.s3Region && config.awsAccessKeyId && config.awsSecretAccessKey);
}

function updateS3Status(config) {
  var configured = isS3Configured(config);

  s3Dot.className = 's3-dot ' + (configured ? 'connected' : 'disconnected');
  s3StatusText.className = 's3-status-text ' + (configured ? 'connected' : 'disconnected');
  s3StatusText.textContent = configured
    ? 'S3 Connected -- ' + config.s3Bucket
    : 'S3 Not Configured';
}

// -- Load Persisted Session State --

function loadSessionState() {
  chrome.storage.local.get(['v1helper_session', 'v1helper_popup_state'], function(result) {
    var session = result.v1helper_session;
    var popupState = result.v1helper_popup_state;

    if (session && session.active && session.session_id) {
      setSessionState('active', session.session_id);
    } else if (popupState && popupState.state === 'error') {
      setSessionState('error', popupState.sessionId);
    } else {
      setSessionState('idle');
    }
  });
}

loadSessionState();

// -- Load S3 Config into form --

chrome.storage.local.get(S3_KEYS, function(config) {
  if (config.s3Bucket) document.getElementById('s3Bucket').value = config.s3Bucket;
  if (config.s3Region) document.getElementById('s3Region').value = config.s3Region;
  if (config.awsAccessKeyId) document.getElementById('awsAccessKeyId').value = config.awsAccessKeyId;
  if (config.awsSecretAccessKey) document.getElementById('awsSecretAccessKey').value = config.awsSecretAccessKey;
  if (config.awsSessionToken) document.getElementById('awsSessionToken').value = config.awsSessionToken;
  updateS3Status(config);
});

// -- Settings Toggle --

settingsBtn.addEventListener('click', function() {
  var isOpen = s3Config.classList.toggle('open');
  settingsBtn.classList.toggle('active', isOpen);
});

// -- Save S3 Config --

document.getElementById('s3SaveBtn').addEventListener('click', function() {
  var config = {
    s3Bucket: document.getElementById('s3Bucket').value.trim(),
    s3Region: document.getElementById('s3Region').value.trim(),
    awsAccessKeyId: document.getElementById('awsAccessKeyId').value.trim(),
    awsSecretAccessKey: document.getElementById('awsSecretAccessKey').value.trim(),
    awsSessionToken: document.getElementById('awsSessionToken').value.trim()
  };
  chrome.storage.local.set(config, function() {
    updateS3Status(config);
    var btn = document.getElementById('s3SaveBtn');
    var orig = btn.textContent;
    btn.textContent = 'Saved!';
    btn.classList.add('saved');
    setTimeout(function() {
      btn.textContent = orig;
      btn.classList.remove('saved');
    }, 1500);
  });
});

// -- Pre-fill Demo --

document.getElementById('s3DemoBtn').addEventListener('click', function() {
  document.getElementById('s3Bucket').value = 'boothapp-sessions-752266476357';
  document.getElementById('s3Region').value = 'us-east-1';
});

// -- Start Session --

startSessionBtn.addEventListener('click', function() {
  chrome.storage.local.get(S3_KEYS, function(config) {
    if (!isS3Configured(config)) {
      setSessionState('error', '');
      sessionLabel.textContent = 'Configure S3 first';
      return;
    }

    var sessionId = 'demo-' + Date.now();
    setSessionState('active', sessionId);

    // Reset counters for new session
    clickCountEl.textContent = '0';
    screenshotCountEl.textContent = '0';

    // Signal background to start session
    chrome.runtime.sendMessage({
      type: 'session_start',
      session_id: sessionId
    });

    // Write active-session.json to S3 so watcher picks it up
    chrome.runtime.sendMessage({
      type: 'write_active_session',
      session_id: sessionId,
      active: true
    });
  });
});

// -- Stop Session --

stopSessionBtn.addEventListener('click', function() {
  var sessionId = sessionIdEl.textContent;
  setSessionState('uploading', sessionId);

  // Signal background to end and upload
  chrome.runtime.sendMessage({ type: 'session_end' }, function() {
    chrome.storage.local.get(['v1helper_clicks'], function(result) {
      var clickBuffer = result.v1helper_clicks || { session_id: sessionId, events: [] };
      chrome.runtime.sendMessage({
        type: 'upload_session',
        session_id: sessionId,
        click_buffer: clickBuffer
      }, function(response) {
        if (response && response.status === 'ok') {
          setSessionState('complete', sessionId);
          clickCountEl.textContent = '0';
          screenshotCountEl.textContent = '0';
          // Deactivate active-session.json
          chrome.runtime.sendMessage({
            type: 'write_active_session',
            session_id: sessionId,
            active: false
          });
          // Return to idle after 3s
          setTimeout(function() { setSessionState('idle'); }, 3000);
        } else {
          setSessionState('error', sessionId);
          sessionLabel.textContent = 'Upload failed';
          // Return to idle after 5s
          setTimeout(function() { setSessionState('idle'); }, 5000);
        }
      });
    });
  });
});

// -- Listen for storage changes (session state from background) --

chrome.storage.onChanged.addListener(function(changes) {
  if (changes.v1helper_session) {
    var session = changes.v1helper_session.newValue;
    if (session && session.active) {
      if (currentSessionState !== 'uploading' && currentSessionState !== 'complete') {
        setSessionState('active', session.session_id);
      }
    } else if (currentSessionState === 'active') {
      setSessionState('idle');
    }
  }
});
