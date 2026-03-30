// ─── Status Polling ──────────────────────────────────────────────────────────

let currentSessionActive = false;
let sessionStartIso = null;
let durationTimer = null;

function formatTime(isoString) {
  if (!isoString) return '--';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (_) {
    return isoString;
  }
}

function formatDuration(startIso) {
  if (!startIso) return '--';
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '--';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return min + ':' + (sec < 10 ? '0' : '') + sec;
  return sec + 's';
}

function truncateId(id) {
  if (!id) return '--';
  return id.length > 16 ? id.slice(0, 16) + '...' : id;
}

function updateDuration() {
  document.getElementById('statDuration').textContent = formatDuration(sessionStartIso);
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'get_popup_status' }, (response) => {
    if (chrome.runtime.lastError || !response || response.status !== 'ok') return;

    // S3 Polling indicator
    const s3Dot = document.getElementById('s3PollDot');
    const s3Text = document.getElementById('s3PollText');
    if (response.s3_polling) {
      s3Dot.classList.add('active');
      s3Text.textContent = 'Polling active';
      s3Text.classList.add('active');
    } else {
      s3Dot.classList.remove('active');
      s3Text.textContent = 'Not configured';
      s3Text.classList.remove('active');
    }

    // Large session indicator
    const indicator = document.getElementById('sessionIndicator');
    const label = document.getElementById('sessionLabel');
    const heroVisitor = document.getElementById('heroVisitor');
    const sessionCard = document.getElementById('sessionCard');

    currentSessionActive = response.session_active;

    // Clear all indicator states first
    indicator.classList.remove('active', 'error');
    label.classList.remove('active', 'error');

    if (response.error_message) {
      // Error state -- red indicator
      indicator.classList.add('error');
      label.textContent = response.error_message;
      label.classList.add('error');
      sessionCard.classList.remove('active');
      heroVisitor.classList.remove('visible');
    } else if (response.session_active) {
      indicator.classList.add('active');
      label.textContent = 'Recording';
      label.classList.add('active');
      sessionCard.classList.add('active');

      if (response.visitor_name) {
        heroVisitor.textContent = response.visitor_name;
        heroVisitor.classList.add('visible');
      } else {
        heroVisitor.classList.remove('visible');
      }

      // Start duration timer
      sessionStartIso = response.start_time || null;
      if (!durationTimer && sessionStartIso) {
        durationTimer = setInterval(updateDuration, 1000);
        updateDuration();
      }
    } else {
      label.textContent = 'No Active Session';
      heroVisitor.classList.remove('visible');
      sessionCard.classList.remove('active');

      // Stop duration timer
      if (durationTimer) {
        clearInterval(durationTimer);
        durationTimer = null;
      }
      sessionStartIso = null;
      document.getElementById('statDuration').textContent = '--';
    }

    // Session button
    updateSessionButton(response.session_active);

    // Stats row
    document.getElementById('statClicks').textContent = response.click_count || '0';
    document.getElementById('statScreenshots').textContent = response.screenshot_count || '0';

    // Session info card
    document.getElementById('infoSessionId').textContent = truncateId(response.session_id);
    document.getElementById('infoSessionId').classList.toggle('muted', !response.session_id);

    document.getElementById('infoVisitor').textContent = response.visitor_name || '--';
    document.getElementById('infoVisitor').classList.toggle('muted', !response.visitor_name);

    document.getElementById('infoStartTime').textContent = formatTime(response.start_time);
    document.getElementById('infoStartTime').classList.toggle('muted', !response.start_time);

    // Last click
    const pathEl = document.getElementById('lastClickPath');
    const timeEl = document.getElementById('lastClickTime');
    if (response.last_click_path) {
      pathEl.textContent = response.last_click_path;
      pathEl.classList.remove('empty');
      timeEl.textContent = formatTime(response.last_click_time);
    } else {
      pathEl.textContent = 'No clicks recorded';
      pathEl.classList.add('empty');
      timeEl.textContent = '';
    }
  });
}

// Poll every 1s while popup is open
refreshStatus();
setInterval(refreshStatus, 1000);

// ─── Session Start/Stop Button ───────────────────────────────────────────────

function updateSessionButton(isActive) {
  const btn = document.getElementById('sessionBtn');
  if (isActive) {
    btn.textContent = 'Stop Session';
    btn.classList.remove('start');
    btn.classList.add('stop');
  } else {
    btn.textContent = 'Start Session';
    btn.classList.remove('stop');
    btn.classList.add('start');
  }
}

document.getElementById('sessionBtn').addEventListener('click', () => {
  if (currentSessionActive) {
    // End session -- background handles upload via polling
    chrome.runtime.sendMessage({ type: 'session_end' }, () => {
      refreshStatus();
    });
  } else {
    // Start a manual session with a generated ID
    const sessionId = 'manual-' + Date.now().toString(36);
    chrome.runtime.sendMessage({ type: 'session_start', session_id: sessionId }, () => {
      refreshStatus();
    });
  }
});

// ─── S3 Config ────────────────────────────────────────────────────────────────

const S3_KEYS = ['s3Bucket', 's3Region', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken'];

function isConfigured(config) {
  return !!(config.s3Bucket && config.s3Region && config.awsAccessKeyId && config.awsSecretAccessKey);
}

function updateConfiguredBadge(config) {
  const badge = document.getElementById('s3ConfiguredBadge');
  badge.style.display = isConfigured(config) ? 'inline' : 'none';
}

// Load saved values and pre-fill fields
chrome.storage.local.get(S3_KEYS, (config) => {
  if (config.s3Bucket)            document.getElementById('s3Bucket').value = config.s3Bucket;
  if (config.s3Region)            document.getElementById('s3Region').value = config.s3Region;
  if (config.awsAccessKeyId)      document.getElementById('awsAccessKeyId').value = config.awsAccessKeyId;
  if (config.awsSecretAccessKey)  document.getElementById('awsSecretAccessKey').value = config.awsSecretAccessKey;
  if (config.awsSessionToken)     document.getElementById('awsSessionToken').value = config.awsSessionToken;
  updateConfiguredBadge(config);
});

// Save button
document.getElementById('s3SaveBtn').addEventListener('click', () => {
  const config = {
    s3Bucket:           document.getElementById('s3Bucket').value.trim(),
    s3Region:           document.getElementById('s3Region').value.trim(),
    awsAccessKeyId:     document.getElementById('awsAccessKeyId').value.trim(),
    awsSecretAccessKey: document.getElementById('awsSecretAccessKey').value.trim(),
    awsSessionToken:    document.getElementById('awsSessionToken').value.trim(),
  };
  chrome.storage.local.set(config, () => {
    updateConfiguredBadge(config);
    const btn = document.getElementById('s3SaveBtn');
    const orig = btn.textContent;
    btn.textContent = 'Saved!';
    btn.classList.add('saved');
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('saved');
    }, 1500);
  });
});

// Pre-fill Demo button
document.getElementById('s3DemoBtn').addEventListener('click', () => {
  document.getElementById('s3Bucket').value = 'boothapp-sessions-752266476357';
  document.getElementById('s3Region').value = 'us-east-1';
});

// Collapsible toggle
document.getElementById('s3ConfigToggle').addEventListener('click', () => {
  const body = document.getElementById('s3ConfigBody');
  const arrow = document.getElementById('s3Arrow');
  const collapsed = body.classList.toggle('collapsed');
  arrow.textContent = collapsed ? '\u25B6' : '\u25BC';
});
