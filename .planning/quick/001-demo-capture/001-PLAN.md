# Feature 5: Demo Capture

## Goal
Implement Casey's Feature 5 (Demo Capture) in the Chrome extension: timed screenshots with timecode naming, POST to local packager, and click tracking POST on session end.

## Success Criteria
- [x] Screenshots captured every 1 second (default), configurable interval via popup
- [x] Screenshots named with timecodes: `screenshot_00m05s123.jpg` (elapsed from session start)
- [x] Screenshots POSTed to local packager at `localhost:9222`
- [x] Click tracking captures: DOM path, element metadata, coordinates, page URL, page title (already done)
- [x] Clicks stored in local storage (already done)
- [x] Clicks POSTed to packager (`localhost:9222`) on session end
- [x] Existing S3 upload path preserved as fallback when packager unavailable

## Changes Required

### background.js
1. Add configurable screenshot interval (default 1s, read from storage)
2. Change periodic timer from 10s to configurable interval
3. Generate timecode filenames from session start time
4. Add postToPackager() function to POST screenshots to localhost:9222
5. Add session-end handler that POSTs clicks.json to packager
6. Keep IndexedDB as local buffer; POST to packager is primary delivery

### popup.html / popup.js
1. Add screenshot interval slider/input in settings section
2. Load/save interval to chrome.storage.local

### manifest.json
1. Add http://localhost:9222/* to host_permissions
