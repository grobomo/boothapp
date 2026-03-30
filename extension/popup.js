// ─── State ───────────────────────────────────────────────────────────────────

let currentSessionActive = false;
let sessionStartIso = null;
let durationTimer = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  if (!startIso) return '--:--';
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '--:--';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
}

function truncateId(id) {
  if (!id) return '--';
  return id.length > 20 ? id.slice(0, 20) + '...' : id;
}

// ─── Duration Timer ──────────────────────────────────────────────────────────

function updateDuration() {
  document.getElementById('circleTimer').textContent = formatDuration(sessionStartIso);
}

// ─── Status Polling ──────────────────────────────────────────────────────────

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'get_popup_status' }, (response) => {
    if (chrome.runtime.lastError || !response || response.status !== 'ok') return;

    // S3 polling indicator (header)
    const s3Dot = document.getElementById('s3PollDot');
    const s3Text = document.getElementById('s3PollText');
    if (response.s3_polling) {
      s3Dot.classList.add('active');
      s3Text.textContent = 'S3: Connected';
      s3Text.classList.add('active');
    } else {
      s3Dot.classList.remove('active');
      s3Text.textContent = 'S3: --';
      s3Text.classList.remove('active');
    }

    // Status circle
    const circle = document.getElementById('statusCircle');
    const timerEl = document.getElementById('circleTimer');
    const labelEl = document.getElementById('circleLabel');
    const heroVisitor = document.getElementById('heroVisitor');
    const heroError = document.getElementById('heroError');

    currentSessionActive = response.session_active;

    // Reset circle state
    circle.classList.remove('recording', 'error');
    heroError.classList.remove('visible');

    if (response.error_message) {
      // Error state -- solid red
      circle.classList.add('error');
      timerEl.textContent = '!!';
      labelEl.textContent = 'ERROR';
      heroError.textContent = response.error_message;
      heroError.classList.add('visible');
      heroVisitor.classList.remove('visible');
    } else if (response.session_active) {
      // Recording -- green pulse
      circle.classList.add('recording');
      labelEl.textContent = 'REC';

      sessionStartIso = response.start_time || null;
      if (!durationTimer && sessionStartIso) {
        durationTimer = setInterval(updateDuration, 1000);
        updateDuration();
      }

      if (response.visitor_name) {
        heroVisitor.textContent = response.visitor_name;
        heroVisitor.classList.add('visible');
      } else {
        heroVisitor.classList.remove('visible');
      }
    } else {
      // Idle -- gray
      timerEl.textContent = '--:--';
      labelEl.textContent = 'IDLE';
      heroVisitor.classList.remove('visible');

      if (durationTimer) {
        clearInterval(durationTimer);
        durationTimer = null;
      }
      sessionStartIso = null;
    }

    // Session button
    updateSessionButton(response.session_active);

    // Stats (large numbers)
    document.getElementById('statClicks').textContent = response.click_count || '0';
    document.getElementById('statScreenshots').textContent = response.screenshot_count || '0';

    // Session info rows
    const sidEl = document.getElementById('infoSessionId');
    sidEl.textContent = truncateId(response.session_id);
    sidEl.classList.toggle('muted', !response.session_id);

    const visEl = document.getElementById('infoVisitor');
    visEl.textContent = response.visitor_name || '--';
    visEl.classList.toggle('muted', !response.visitor_name);

    const startEl = document.getElementById('infoStartTime');
    startEl.textContent = formatTime(response.start_time);
    startEl.classList.toggle('muted', !response.start_time);
  });
}

// Poll every 1s
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
    chrome.runtime.sendMessage({ type: 'session_end' }, () => {
      refreshStatus();
    });
  } else {
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
  document.getElementById('s3ConfiguredBadge').style.display = isConfigured(config) ? 'inline' : 'none';
}

// Load saved values
chrome.storage.local.get(S3_KEYS, (config) => {
  if (config.s3Bucket)            document.getElementById('s3Bucket').value = config.s3Bucket;
  if (config.s3Region)            document.getElementById('s3Region').value = config.s3Region;
  if (config.awsAccessKeyId)      document.getElementById('awsAccessKeyId').value = config.awsAccessKeyId;
  if (config.awsSecretAccessKey)  document.getElementById('awsSecretAccessKey').value = config.awsSecretAccessKey;
  if (config.awsSessionToken)     document.getElementById('awsSessionToken').value = config.awsSessionToken;
  updateConfiguredBadge(config);
});

// Save
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

// Pre-fill Demo
document.getElementById('s3DemoBtn').addEventListener('click', () => {
  document.getElementById('s3Bucket').value = 'boothapp-sessions-752266476357';
  document.getElementById('s3Region').value = 'us-east-1';
});

// Collapsible toggle
document.getElementById('s3ConfigToggle').addEventListener('click', () => {
  const body = document.getElementById('s3ConfigBody');
  const arrow = document.getElementById('s3Arrow');
  const collapsed = body.classList.toggle('collapsed');
  if (collapsed) {
    arrow.classList.remove('open');
    arrow.textContent = '\u25B6';
  } else {
    arrow.classList.add('open');
    arrow.textContent = '\u25BC';
  }
});
