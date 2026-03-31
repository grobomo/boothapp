/**
 * BoothApp Content Script
 *
 * Renders a note input overlay when the SE presses Ctrl+Shift+N.
 * The note is sent to the background service worker for storage
 * in the session events array.
 */

(function () {
  "use strict";

  let overlayVisible = false;

  function createOverlay() {
    // Prevent duplicates
    if (document.getElementById("boothapp-note-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "boothapp-note-overlay";
    overlay.innerHTML = `
      <div class="boothapp-note-dialog">
        <div class="boothapp-note-header">
          <span class="boothapp-note-badge">SE</span>
          <span class="boothapp-note-title">Add Session Note</span>
          <span class="boothapp-note-hint">Enter to save, Esc to cancel</span>
        </div>
        <textarea id="boothapp-note-input"
                  placeholder="Type your note..."
                  rows="3"
                  maxlength="500"></textarea>
        <div class="boothapp-note-footer">
          <span class="boothapp-note-counter">0 / 500</span>
          <button id="boothapp-note-save" type="button">Save Note</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = document.getElementById("boothapp-note-input");
    const saveBtn = document.getElementById("boothapp-note-save");
    const counter = overlay.querySelector(".boothapp-note-counter");

    // Focus the textarea
    setTimeout(() => input.focus(), 50);

    // Character counter
    input.addEventListener("input", () => {
      counter.textContent = input.value.length + " / 500";
    });

    // Save on Enter (without Shift)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        saveNote(input.value);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        removeOverlay();
      }
    });

    // Save button click
    saveBtn.addEventListener("click", () => {
      saveNote(input.value);
    });

    // Click outside to dismiss
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        removeOverlay();
      }
    });

    overlayVisible = true;
  }

  function saveNote(text) {
    text = text.trim();
    if (!text) {
      removeOverlay();
      return;
    }

    chrome.runtime.sendMessage(
      { action: "save-note", text: text },
      (response) => {
        if (response && response.success) {
          showConfirmation();
        }
        removeOverlay();
      }
    );
  }

  function showConfirmation() {
    const toast = document.createElement("div");
    toast.className = "boothapp-note-toast";
    toast.textContent = "Note saved";
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("boothapp-note-toast-fade");
      setTimeout(() => toast.remove(), 300);
    }, 1500);
  }

  function removeOverlay() {
    const overlay = document.getElementById("boothapp-note-overlay");
    if (overlay) {
      overlay.remove();
    }
    overlayVisible = false;
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "show-note-input") {
      if (overlayVisible) {
        removeOverlay();
      } else {
        createOverlay();
      }
      sendResponse({ success: true });
    }
    return true;
  });
})();
