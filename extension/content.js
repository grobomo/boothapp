// CaseyApp Content Script
// Intercepts clicks and forwards to background for screenshot capture

(() => {
  let clickIndex = 0;
  let sessionActive = false;

  // Click buffer stored in chrome.storage.local
  function recordClick(event) {
    if (!sessionActive) return;

    clickIndex++;
    const target = event.target;
    const clickEvent = {
      index: clickIndex,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      pageTitle: document.title,
      x: event.clientX,
      y: event.clientY,
      tagName: target.tagName,
      id: target.id || null,
      className: target.className || null,
      textContent: (target.textContent || '').slice(0, 100),
    };

    // Save to click buffer
    chrome.storage.local.get(['caseyapp_clicks'], (result) => {
      const buffer = result.caseyapp_clicks || { events: [] };
      buffer.events.push(clickEvent);
      chrome.storage.local.set({ caseyapp_clicks: buffer });
    });

    // Trigger screenshot in background
    chrome.runtime.sendMessage({
      type: 'click_event',
      event: { index: clickIndex, timestamp: clickEvent.timestamp },
    }).catch(() => {});
  }

  document.addEventListener('click', recordClick, true);

  // Listen for session state changes from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'session_state_changed') {
      sessionActive = msg.active;
      if (!msg.active) clickIndex = 0;
    }
  });

  // Check initial session state
  chrome.storage.local.get(['caseyapp_session'], (result) => {
    const session = result.caseyapp_session;
    sessionActive = !!(session && session.active);
  });
})();
