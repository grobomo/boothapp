# Feature 5: Demo Capture -- Summary

## What Was Done

Implemented Casey's Feature 5 (Demo Capture) from CaseyApp_Feature_Document.md in the Chrome extension.

## Changes

### extension/background.js
- Timecoded filenames: screenshot_00m05s123.jpg using elapsed ms from session start (start_epoch)
- Configurable 1s capture interval: default 1000ms, stored as screenshotIntervalMs
- Packager POST: screenshots POSTed to localhost:9222/screenshots as multipart form data
- Clicks POST: clicks POSTed to localhost:9222/clicks as JSON on session end
- Graceful fallback: packager failures logged as warnings, IndexedDB + S3 upload preserved

### extension/popup.html + popup.js
- Screenshot interval selector (0.5s / 1s / 2s / 5s) in settings panel

### extension/manifest.json
- Version 1.2.0, added localhost:9222 to host_permissions

## Design Decisions

1. Fire-and-forget packager POST: no blocking, IndexedDB fallback
2. start_epoch for precise timecode calc without ISO parsing
3. Interval restart on storage change: no reload needed
4. Dual delivery on session end: packager + S3 for resilience

## PR
https://github.com/altarr/boothapp/pull/381
