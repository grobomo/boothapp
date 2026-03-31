# Demo Capture -- Chrome Extension (Feature 5)

## Goal

Build a Chrome Extension (Manifest V3) that captures screenshots and click interactions during a live product demo, sending data to a local packager service.

## Success Criteria

1. Screenshots captured every 1 second (interval configurable via popup slider)
2. Screenshots named with timecodes: `screenshot_00m05s123.jpg` (elapsed from session start)
3. Screenshots POSTed to local packager at `localhost:9222`
4. All clicks tracked with: DOM path, element metadata, coordinates, page URL, page title
5. Clicks stored in extension local storage
6. Clicks POSTed to packager on session end
7. Extension popup provides start/stop controls and interval configuration
8. Extension uses Manifest V3 (service worker, not background page)
