# Popup Error State Enhancement

## Goal
Add red=error state to the Chrome extension popup hero indicator, completing the three-state status circle (green=recording, gray=idle, red=error). Error state surfaces S3 upload failures, screenshot capture failures, and polling errors to the SE during demo.

## Success Criteria
1. Hero indicator shows RED with error glow when an error occurs
2. Error state label shows descriptive error text (e.g. "Upload Failed", "S3 Error")
3. Background.js tracks and exposes error state via get_popup_status response
4. Error auto-clears when session recovers or new session starts
5. No new permissions required -- uses existing storage + tabs + activeTab
6. Popup polls and displays error state alongside existing click/screenshot/duration stats
