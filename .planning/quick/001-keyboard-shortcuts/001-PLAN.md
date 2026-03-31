# Keyboard Shortcuts for Presenter Pages

## Goal
Add keyboard shortcuts to demo.html and sessions.html presenter pages for hands-free control during trade show presentations.

## Success Criteria
1. P key toggles play/pause on the auto-refresh timeline (activity feed)
2. Left/Right arrow keys navigate between key moments (feed items)
3. S key toggles the summary side panel visibility
4. F key toggles fullscreen mode
5. Escape key closes any open overlay
6. A ? button in the corner shows a keyboard shortcut reference card overlay
7. Shortcuts only fire when not typing in an input field
8. Both demo.html and sessions.html get the shortcuts

## Approach
- Add a shared keyboard handler at the bottom of each HTML file
- Add CSS for the ? button, reference card overlay, and highlighted feed items
- P toggles the setInterval refresh (pause/resume the countdown timer)
- Left/Right scrolls feed and highlights items
- S toggles side-panel display
- F uses Fullscreen API
- ? button + overlay with shortcut reference
