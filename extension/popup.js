/* BoothApp Popup Controller
   Reads state from chrome.storage.local and updates the popup UI. */

const $ = (id) => document.getElementById(id);

// ---- State defaults ----
const DEFAULT_STATE = {
  recording: false,
  visitorName: '',
  visitorCompany: '',
  clicks: 0,
  screenshots: 0,
  s3Connected: false,
  sessionStart: null
};

// ---- Render UI from state ----
function render(state) {
  const s = { ...DEFAULT_STATE, ...state };

  // Version from manifest
  const manifest = chrome.runtime.getManifest();
  $('version').textContent = 'v' + manifest.version;

  // Session status
  const dot = $('statusDot');
  const label = $('statusLabel');
  if (s.recording) {
    dot.classList.add('recording');
    label.textContent = 'Recording';
    label.className = 'status-label recording';
  } else {
    dot.classList.remove('recording');
    label.textContent = 'Stopped';
    label.className = 'status-label stopped';
  }

  // Session timer
  if (s.recording && s.sessionStart) {
    updateTimer(s.sessionStart);
  } else {
    $('sessionTime').textContent = '--:--:--';
  }

  // Visitor card
  const card = $('visitorCard');
  if (s.recording && s.visitorName) {
    card.classList.remove('empty');
    card.innerHTML =
      '<div class="visitor-name">' + escapeHtml(s.visitorName) + '</div>' +
      (s.visitorCompany
        ? '<div class="visitor-company">' + escapeHtml(s.visitorCompany) + '</div>'
        : '');
  } else {
    card.classList.add('empty');
    card.textContent = s.recording ? 'Waiting for badge scan...' : 'No active session';
  }

  // Counters
  $('clickCount').textContent = s.clicks;
  $('screenshotCount').textContent = s.screenshots;

  // S3 connection
  const s3 = $('s3Status');
  if (s.s3Connected) {
    s3.textContent = 'Connected';
    s3.className = 'conn-status connected';
  } else {
    s3.textContent = 'Disconnected';
    s3.className = 'conn-status disconnected';
  }

  // Action button
  const btn = $('actionBtn');
  if (s.recording) {
    btn.textContent = 'Stop Session';
    btn.className = 'btn btn-stop';
  } else {
    btn.textContent = 'Start Session';
    btn.className = 'btn btn-start';
  }
}

// ---- Timer ----
let timerInterval = null;

function updateTimer(startTime) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  $('sessionTime').textContent = h + ':' + m + ':' + s;
}

function startTimer(startTime) {
  stopTimer();
  updateTimer(startTime);
  timerInterval = setInterval(() => updateTimer(startTime), 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ---- Escape HTML ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Button handler ----
$('actionBtn').addEventListener('click', () => {
  chrome.storage.local.get(DEFAULT_STATE, (state) => {
    if (state.recording) {
      // Stop session
      chrome.storage.local.set({
        recording: false,
        sessionStart: null
      }, () => {
        stopTimer();
        loadAndRender();
      });
    } else {
      // Start session
      chrome.storage.local.set({
        recording: true,
        clicks: 0,
        screenshots: 0,
        visitorName: '',
        visitorCompany: '',
        sessionStart: Date.now()
      }, () => {
        loadAndRender();
      });
    }
  });
});

// ---- Load state and render ----
function loadAndRender() {
  chrome.storage.local.get(DEFAULT_STATE, (state) => {
    render(state);
    if (state.recording && state.sessionStart) {
      startTimer(state.sessionStart);
    } else {
      stopTimer();
    }
  });
}

// ---- Listen for storage changes ----
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    loadAndRender();
  }
});

// ---- Init ----
loadAndRender();
