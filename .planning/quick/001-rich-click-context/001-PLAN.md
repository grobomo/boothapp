# Rich Click Context Capture

## Goal
Enhance the Chrome extension's content.js to capture richer click context data, add a screenshot quality setting configurable via popup, and update the clicks.json schema.

## Success Criteria
1. Each click captures visible text of the element (innerText, truncated to 200 chars)
2. Each click captures the page title at the time of click
3. Each click captures viewport scroll position (scrollX, scrollY)
4. Each click detects if this is a navigation click (href or router change)
5. For select/dropdown clicks, capture the selected option
6. For form inputs, capture the field label (not the value, for privacy)
7. Screenshot quality setting (low=480p, medium=720p, high=1080p) configurable via popup
8. clicks.json schema updated with all new fields
9. DATA-CONTRACT.md updated to reflect new schema fields
