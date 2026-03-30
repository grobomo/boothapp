# Presenter Dashboard

## Goal
Create `presenter/index.html` — a live presenter dashboard that shows current session info during booth demos. Single HTML file with embedded CSS/JS that reads from S3.

## Success Criteria
1. Single HTML file at `presenter/index.html` with embedded CSS and JS
2. Displays: visitor name, session duration timer, click count, recording status
3. Reads from S3 `sessions/<session-id>/metadata.json` and `clicks/clicks.json`
4. Auto-refreshes every 5 seconds
5. Large fonts readable from 3 meters away
6. Dark theme
7. Session ID selectable via URL parameter (e.g., `?session=A726594`)
