/**
 * BoothApp Background Service Worker
 *
 * Handles the Ctrl+Shift+N command to add SE notes during a session.
 * Notes are stored in the session's click events array with type='note'.
 */

// Session state
let sessionActive = false;
let sessionStartTime = null;
let events = [];

// Listen for the add-note command (Ctrl+Shift+N)
chrome.commands.onCommand.addListener((command) => {
  if (command === "add-note") {
    // Send message to active tab's content script to show note input
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "show-note-input" });
      }
    });
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "save-note") {
    const noteEvent = {
      type: "note",
      timestamp: Date.now() - (sessionStartTime || Date.now()),
      text: message.text,
      url: sender.tab ? sender.tab.url : ""
    };
    events.push(noteEvent);
    sendResponse({ success: true, eventIndex: events.length - 1 });
  }

  if (message.action === "start-session") {
    sessionActive = true;
    sessionStartTime = Date.now();
    events = [];
    sendResponse({ success: true });
  }

  if (message.action === "get-events") {
    sendResponse({ events: events });
  }

  return true; // keep message channel open for async response
});
