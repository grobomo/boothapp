// ─── Version ─────────────────────────────────────────────────────────────────

(function setVersion() {
  var manifest = chrome.runtime.getManifest();
  var el = document.getElementById('footerVer');
  if (el && manifest.version) el.textContent = 'v' + manifest.version;
})();

// ─── State ───────────────────────────────────────────────────────────────────

var currentSessionActive = false;
var sessionStartIso = null;
var durationTimer = null;
var s3Configured = false;
var lastSessionWasActive = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(isoString) {
  if (!isoString) return '--';
  try {
    var d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (_) {
    return isoString;
  }
}

function formatDuration(startIso) {
  if (!startIso) return '--:--';
  var ms = Date.now() - new Date(startIso).getTime();
  if (ms < 0) return '--:--';
  var totalSec = Math.floor(ms / 1000);
  var h = Math.floor(totalSec / 3600);
  var min = Math.floor((totalSec % 3600) / 60);
  var sec = totalSec % 60;
  if (h > 0) {
    return h + ':' + (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
  }
  return (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
}

function truncateId(id) {
  if (!id) return '--';
  return id.length > 20 ? id.slice(0, 20) + '...' : id;
}

// ─── Duration Timer ──────────────────────────────────────────────────────────

function updateDuration() {
  document.getElementById('ringTimer').textContent = formatDuration(sessionStartIso);
}

// ─── UI State Machine ────────────────────────────────────────────────────────

function setRingState(state) {
  var ring = document.getElementById('statusRing');
  var timerEl = document.getElementById('ringTimer');
  var labelEl = document.getElementById('ringLabel');

  ring.classList.remove('recording', 'uploading', 'complete', 'error');

  if (state === 'recording') {
    ring.classList.add('recording');
    labelEl.textContent = 'REC';
  } else if (state === 'uploading') {
    ring.classList.add('uploading');
    labelEl.textContent = 'UPLOADING';
  } else if (state === 'complete') {
    ring.classList.add('complete');
  } else if (state === 'error') {
    ring.classList.add('error');
    timerEl.textContent = '!!';
    labelEl.textContent = 'ERROR';
  } else {
    timerEl.textContent = '--:--';
    labelEl.textContent = 'IDLE';
  }
}

// ─── Button Visibility ──────────────────────────────────────────────────────

function updateButtonVisibility() {
  var wrap = document.getElementById('btnWrap');
  if (s3Configured) {
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
  }
}

// ─── Status Polling ──────────────────────────────────────────────────────────

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'get_popup_status' }, function(response) {
    if (chrome.runtime.lastError || !response || response.status !== 'ok') return;

    // S3 connection indicator
    var s3Dot = document.getElementById('s3PollDot');
    var s3Text = document.getElementById('s3PollText');
    s3Configured = !!response.s3_polling;
    if (s3Configured) {
      s3Dot.classList.add('active');
      s3Text.textContent = 'S3';
      s3Text.classList.add('active');
    } else {
      s3Dot.classList.remove('active');
      s3Text.textContent = 'S3';
      s3Text.classList.remove('active');
    }
    updateButtonVisibility();

    var heroVisitor = document.getElementById('heroVisitor');
    var heroError = document.getElementById('heroError');

    currentSessionActive = response.session_active;

    // Reset transient UI
    heroError.classList.remove('visible');

    if (response.error_message) {
      setRingState('error');
      heroError.textContent = response.error_message;
      heroError.classList.add('visible');
      heroVisitor.classList.remove('visible');
    } else if (response.uploading) {
      setRingState('uploading');
      heroVisitor.classList.remove('visible');
    } else if (response.session_active) {
      setRingState('recording');
      lastSessionWasActive = true;

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
      // Session not active -- show complete if we just ended one
      if (lastSessionWasActive && !response.uploading) {
        setRingState('complete');
        lastSessionWasActive = false;
        // Auto-clear complete state after 5 seconds
        setTimeout(function() {
          if (!currentSessionActive) {
            setRingState('idle');
          }
        }, 5000);
      } else if (!lastSessionWasActive) {
        setRingState('idle');
      }
      heroVisitor.classList.remove('visible');

      if (durationTimer) {
        clearInterval(durationTimer);
        durationTimer = null;
      }
      sessionStartIso = null;
    }

    // Session button
    updateSessionButton(response.session_active);

    // Stats
    document.getElementById('statClicks').textContent = response.click_count || '0';
    document.getElementById('statScreenshots').textContent = response.screenshot_count || '0';

    // Session info rows
    var sidEl = document.getElementById('infoSessionId');
    sidEl.textContent = truncateId(response.session_id);
    sidEl.classList.toggle('muted', !response.session_id);

    var visEl = document.getElementById('infoVisitor');
    visEl.textContent = response.visitor_name || '--';
    visEl.classList.toggle('muted', !response.visitor_name);

    var startEl = document.getElementById('infoStartTime');
    startEl.textContent = formatTime(response.start_time);
    startEl.classList.toggle('muted', !response.start_time);
  });
}

// Poll every 1s
refreshStatus();
setInterval(refreshStatus, 1000);

// ─── Session Start/Stop Button ───────────────────────────────────────────────

function updateSessionButton(isActive) {
  var btn = document.getElementById('sessionBtn');
  if (isActive) {
    btn.textContent = 'End Demo';
    btn.classList.remove('start');
    btn.classList.add('stop');
  } else {
    btn.textContent = 'Start Demo';
    btn.classList.remove('stop');
    btn.classList.add('start');
  }
}

document.getElementById('sessionBtn').addEventListener('click', function() {
  if (currentSessionActive) {
    chrome.runtime.sendMessage({ type: 'session_end' }, function() {
      refreshStatus();
    });
  } else {
    var sessionId = 'manual-' + Date.now().toString(36);
    chrome.runtime.sendMessage({ type: 'session_start', session_id: sessionId }, function() {
      refreshStatus();
    });
  }
});

// ─── Gear Toggle ─────────────────────────────────────────────────────────────

document.getElementById('gearBtn').addEventListener('click', function() {
  var section = document.getElementById('s3Section');
  var gear = document.getElementById('gearBtn');
  var isOpen = section.classList.toggle('open');
  gear.classList.toggle('open', isOpen);
});

// ─── S3 Config ────────────────────────────────────────────────────────────────

var S3_KEYS = ['s3Bucket', 's3Region', 'presignEndpoint', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken'];

// Load saved values
chrome.storage.local.get(S3_KEYS, function(config) {
  if (config.s3Bucket)            document.getElementById('s3Bucket').value = config.s3Bucket;
  if (config.s3Region)            document.getElementById('s3Region').value = config.s3Region;
  if (config.presignEndpoint)     document.getElementById('presignEndpoint').value = config.presignEndpoint;
  if (config.awsAccessKeyId)      document.getElementById('awsAccessKeyId').value = config.awsAccessKeyId;
  if (config.awsSecretAccessKey)  document.getElementById('awsSecretAccessKey').value = config.awsSecretAccessKey;
  if (config.awsSessionToken)     document.getElementById('awsSessionToken').value = config.awsSessionToken;
});

// Save
document.getElementById('s3SaveBtn').addEventListener('click', function() {
  var config = {
    s3Bucket:           document.getElementById('s3Bucket').value.trim(),
    s3Region:           document.getElementById('s3Region').value.trim(),
    presignEndpoint:    document.getElementById('presignEndpoint').value.trim(),
    awsAccessKeyId:     document.getElementById('awsAccessKeyId').value.trim(),
    awsSecretAccessKey: document.getElementById('awsSecretAccessKey').value.trim(),
    awsSessionToken:    document.getElementById('awsSessionToken').value.trim(),
  };
  chrome.storage.local.set(config, function() {
    var btn = document.getElementById('s3SaveBtn');
    var orig = btn.textContent;
    btn.textContent = 'Saved!';
    btn.classList.add('saved');
    setTimeout(function() {
      btn.textContent = orig;
      btn.classList.remove('saved');
    }, 1500);
    // Refresh to pick up new S3 status
    refreshStatus();
  });
});

// Pre-fill Demo
document.getElementById('s3DemoBtn').addEventListener('click', function() {
  document.getElementById('s3Bucket').value = 'boothapp-sessions-752266476357';
  document.getElementById('s3Region').value = 'us-east-1';
  document.getElementById('presignEndpoint').focus();
  document.getElementById('presignEndpoint').setAttribute('placeholder', 'Paste Lambda Function URL here');
});

// ─── QR Code Pairing ─────────────────────────────────────────────────────────

document.getElementById('pairBtn').addEventListener('click', function() {
  chrome.storage.local.get(S3_KEYS, function(config) {
    // Build pairing payload with current S3 config
    var payload = {
      type: 'boothapp-pair',
      v: 1,
      s3Bucket: config.s3Bucket || '',
      s3Region: config.s3Region || '',
      presignEndpoint: config.presignEndpoint || '',
      awsAccessKeyId: config.awsAccessKeyId || '',
      awsSecretAccessKey: config.awsSecretAccessKey || '',
      awsSessionToken: config.awsSessionToken || '',
    };

    var json = JSON.stringify(payload);

    // Generate QR code using qrcode-generator (Kazuhiko Arase, MIT)
    // typeNumber 0 = auto-detect version, 'M' = medium error correction
    var qr = qrcode(0, 'M');
    qr.addData(json);
    qr.make();

    // Render as SVG (no canvas dependency)
    var svgTag = qr.createSvgTag(4, 0);
    var container = document.getElementById('qrImage');
    container.innerHTML = svgTag;
    document.getElementById('qrOverlay').classList.add('visible');
  });
});

document.getElementById('qrCloseBtn').addEventListener('click', function() {
  document.getElementById('qrOverlay').classList.remove('visible');
});

// Hide QR overlay when clicking outside the container
document.getElementById('qrOverlay').addEventListener('click', function(e) {
  if (e.target === this) {
    this.classList.remove('visible');
  }
});
