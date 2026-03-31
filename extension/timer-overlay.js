// V1-Helper Timer Overlay
// Shows elapsed time, click count, and recording indicator during active sessions.
// Injected by content.js — top frame only.

/* global chrome */

const TimerOverlay = (() => {
  let container = null;
  let timerInterval = null;
  let startTime = null;
  let minimized = false;
  let clickCount = 0;

  const STORAGE_KEY = 'v1helper_clicks';

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const sec = (totalSec % 60).toString().padStart(2, '0');
    return min + ':' + sec;
  }

  function create() {
    if (container) return;

    container = document.createElement('div');
    container.id = 'v1helper-timer-overlay';
    const shadow = container.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      .overlay {
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 2147483646;
        font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
        font-size: 12px;
        pointer-events: auto;
        user-select: none;
      }
      .panel {
        background: rgba(18, 18, 28, 0.88);
        border: 1px solid rgba(167, 139, 250, 0.3);
        border-radius: 8px;
        padding: 8px 12px;
        color: #e0e0e0;
        display: flex;
        align-items: center;
        gap: 10px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        transition: opacity 0.2s, transform 0.2s;
      }
      .panel.hidden {
        display: none;
      }
      .dot-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        height: 12px;
      }
      .rec-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ef4444;
        animation: pulse 1.5s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.75); }
      }
      .timer {
        color: #a78bfa;
        font-weight: 600;
        letter-spacing: 0.5px;
        min-width: 40px;
      }
      .divider {
        width: 1px;
        height: 14px;
        background: rgba(255, 255, 255, 0.15);
      }
      .clicks {
        color: #94a3b8;
        font-size: 11px;
      }
      .clicks strong {
        color: #e0e0e0;
        font-weight: 600;
      }
      .btn-min {
        background: none;
        border: none;
        color: #64748b;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 0 2px;
        transition: color 0.15s;
      }
      .btn-min:hover {
        color: #a78bfa;
      }
      /* Minimized state: just the dot */
      .dot-only {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgba(18, 18, 28, 0.88);
        border: 1px solid rgba(167, 139, 250, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        transition: transform 0.15s;
      }
      .dot-only:hover {
        transform: scale(1.2);
      }
      .dot-only .rec-dot {
        width: 6px;
        height: 6px;
      }
      .dot-only.hidden {
        display: none;
      }
    `;

    const html = document.createElement('div');
    html.classList.add('overlay');
    html.innerHTML = `
      <div class="panel">
        <div class="dot-wrap"><div class="rec-dot"></div></div>
        <span class="timer">00:00</span>
        <div class="divider"></div>
        <span class="clicks"><strong>0</strong> clicks</span>
        <button class="btn-min" title="Minimize">&#x2212;</button>
      </div>
      <div class="dot-only hidden">
        <div class="rec-dot"></div>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(html);

    // Event handlers
    const btnMin = shadow.querySelector('.btn-min');
    const panel = shadow.querySelector('.panel');
    const dotOnly = shadow.querySelector('.dot-only');

    btnMin.addEventListener('click', (e) => {
      e.stopPropagation();
      minimized = true;
      panel.classList.add('hidden');
      dotOnly.classList.remove('hidden');
    });

    dotOnly.addEventListener('click', (e) => {
      e.stopPropagation();
      minimized = false;
      dotOnly.classList.add('hidden');
      panel.classList.remove('hidden');
    });

    document.documentElement.appendChild(container);

    // Store refs for updates
    container._shadow = shadow;
  }

  function updateDisplay() {
    if (!container || !container._shadow) return;
    const shadow = container._shadow;

    // Update timer
    const elapsed = Date.now() - startTime;
    const timerEl = shadow.querySelector('.timer');
    if (timerEl) timerEl.textContent = formatTime(elapsed);

    // Update click count from storage
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const buffer = result[STORAGE_KEY];
      const count = buffer && buffer.events ? buffer.events.length : 0;
      clickCount = count;
      const clicksEl = shadow.querySelector('.clicks');
      if (clicksEl) {
        clicksEl.innerHTML = '<strong>' + count + '</strong> click' + (count !== 1 ? 's' : '');
      }
    });
  }

  function show() {
    startTime = Date.now();
    clickCount = 0;
    minimized = false;
    create();

    // Ensure expanded state on new session
    if (container && container._shadow) {
      const panel = container._shadow.querySelector('.panel');
      const dotOnly = container._shadow.querySelector('.dot-only');
      if (panel) panel.classList.remove('hidden');
      if (dotOnly) dotOnly.classList.add('hidden');
    }

    updateDisplay();
    timerInterval = setInterval(updateDisplay, 1000);
  }

  function hide() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    startTime = null;
    minimized = false;
  }

  return { show, hide };
})();
