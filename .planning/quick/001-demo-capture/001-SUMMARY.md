# Demo Capture -- Summary

## What was done

Implemented Feature 5 (Demo Capture) as a Manifest V3 Chrome extension in `chrome-extension/`.

### Files created

- `manifest.json` -- MV3 config with service_worker, content_scripts, storage + tabs permissions
- `background.js` -- Screenshot capture timer (1s default, configurable 200ms-5s), session lifecycle, packager POST communication, service worker state restoration on wake
- `content.js` -- Click event interception with DOM path builder, element metadata extractor (tag, id, class, text, href, type, name, aria-label, role, bounding rect), coordinates (client/page/screen), page URL and title
- `popup.html/js` -- TrendAI-branded dark UI with start/stop controls, interval slider with live adjustment during capture, elapsed timer, screenshot/click counters
- `icons/` -- 16/48/128px placeholder icons

### Key design decisions

1. **Screenshots POSTed as FormData** -- multipart with filename, sessionId, timecode, elapsedMs, timestamp. Packager receives the JPEG blob directly.
2. **Clicks accumulated in chrome.storage.local** -- not POSTed individually. Batch POST to `/clicks` only on session end to minimize network chatter during demo.
3. **Service worker state restoration** -- on wake, reads session state from storage and resumes capture interval. Handles MV3 service worker lifecycle correctly.
4. **Password input redaction** -- content.js redacts password field values in click metadata.
5. **Interval adjustable mid-session** -- popup sends UPDATE_INTERVAL message, background clears and restarts the timer.

### Success criteria verification

All 8 criteria from 001-PLAN.md met:
1. [x] Screenshots every 1s (configurable) -- DEFAULT_INTERVAL_MS = 1000, slider 200-5000ms
2. [x] Timecoded filenames -- formatTimecode() produces `screenshot_00m05s123.jpg`
3. [x] POST to localhost:9222 -- PACKAGER_URL constant, FormData POST to /screenshots
4. [x] Click tracking with DOM path, metadata, coords, URL, title -- full implementation in content.js
5. [x] Clicks in local storage -- chrome.storage.local via CLICK_EVENT message
6. [x] Clicks POST on session end -- stopCapture() POSTs to /clicks
7. [x] Popup with start/stop + interval config -- popup.html/js with both views
8. [x] Manifest V3 service worker -- manifest.json background.service_worker

### PR

https://github.com/grobomo/boothapp/pull/132 -- CI passing (secret-scan + tests)
