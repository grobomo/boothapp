// CaseyApp Demo Capture -- Popup Controller

const $ = (id) => document.getElementById(id);

let statusPollId = null;

// --- UI elements ---

const idleView = $('idleView');
const activeView = $('activeView');
const statusDot = $('statusDot');
const startBtn = $('startBtn');
const stopBtn = $('stopBtn');
const intervalSlider = $('intervalSlider');
const intervalDisplay = $('intervalDisplay');
const intervalSliderActive = $('intervalSliderActive');
const intervalDisplayActive = $('intervalDisplayActive');
const elapsedTime = $('elapsedTime');
const screenshotCount = $('screenshotCount');
const clickCount = $('clickCount');

// --- Interval slider ---

function formatInterval(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

function onSliderChange(slider, display) {
  const ms = parseInt(slider.value);
  display.textContent = formatInterval(ms);
  chrome.storage.local.set({ intervalMs: ms });
}

intervalSlider.addEventListener('input', () => {
  onSliderChange(intervalSlider, intervalDisplay);
});

intervalSliderActive.addEventListener('input', () => {
  onSliderChange(intervalSliderActive, intervalDisplayActive);
  // Update running interval in real time
  chrome.runtime.sendMessage({
    type: 'UPDATE_INTERVAL',
    intervalMs: parseInt(intervalSliderActive.value)
  });
});

// --- Start/Stop ---

startBtn.addEventListener('click', () => {
  const sid = 'session_' + Date.now();
  const ms = parseInt(intervalSlider.value);
  chrome.runtime.sendMessage({
    type: 'START_SESSION',
    sessionId: sid,
    intervalMs: ms
  }, () => {
    showActive();
    startPolling();
  });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_SESSION' }, () => {
    showIdle();
    stopPolling();
  });
});

// --- View toggling ---

function showActive() {
  idleView.classList.add('hidden');
  activeView.classList.remove('hidden');
  statusDot.classList.add('active');
}

function showIdle() {
  idleView.classList.remove('hidden');
  activeView.classList.add('hidden');
  statusDot.classList.remove('active');
  elapsedTime.textContent = '00:00';
  screenshotCount.textContent = '0';
  clickCount.textContent = '0';
}

// --- Status polling ---

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function pollStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (!status || !status.active) {
      showIdle();
      stopPolling();
      return;
    }

    elapsedTime.textContent = formatElapsed(status.elapsed);

    // Estimate screenshot count from elapsed time and interval
    const estimated = Math.floor(status.elapsed / status.intervalMs) + 1;
    screenshotCount.textContent = String(estimated);
  });

  // Update click count from storage
  chrome.storage.local.get(['clickEvents'], (data) => {
    const clicks = data.clickEvents || [];
    clickCount.textContent = String(clicks.length);
  });
}

function startPolling() {
  if (statusPollId) clearInterval(statusPollId);
  pollStatus();
  statusPollId = setInterval(pollStatus, 500);
}

function stopPolling() {
  if (statusPollId) {
    clearInterval(statusPollId);
    statusPollId = null;
  }
}

// --- Init ---

chrome.storage.local.get(['intervalMs'], (data) => {
  const ms = data.intervalMs || 1000;
  intervalSlider.value = ms;
  intervalSliderActive.value = ms;
  intervalDisplay.textContent = formatInterval(ms);
  intervalDisplayActive.textContent = formatInterval(ms);
});

// Check if session is already active
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
  if (status && status.active) {
    intervalSliderActive.value = status.intervalMs;
    intervalDisplayActive.textContent = formatInterval(status.intervalMs);
    showActive();
    startPolling();
  } else {
    showIdle();
  }
});
