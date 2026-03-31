# Session Data Viewer

## Goal
Create `presenter/session-viewer.html` that displays full session data (visitor info, timeline, transcript, analysis, products, follow-ups) fetched from S3 via the presenter server API. Dark theme matching existing pages.

## Success Criteria
1. session-viewer.html loads at `/session-viewer.html?session=<id>`
2. Visitor info card shows name, company, title from metadata.json + badge.json
3. Session timeline displays as vertical scrollable list with timestamps, click descriptions, screenshot thumbnails
4. Transcript panel shows full transcript with speaker labels
5. Analysis summary panel shows output/summary.json data
6. Products demonstrated list extracted from analysis
7. Follow-up actions displayed
8. All data fetched from S3 via presenter server API (new endpoints)
9. Dark theme consistent with sessions.html / admin.html
10. Graceful error handling for missing data

## Implementation
1. Add API endpoints to server.js: GET /api/sessions/:id/detail (metadata+badge), GET /api/sessions/:id/timeline, GET /api/sessions/:id/transcript, GET /api/sessions/:id/analysis, GET /api/sessions/:id/screenshot/:filename
2. Create presenter/session-viewer.html with all panels
3. Link from sessions.html table rows to session-viewer.html
