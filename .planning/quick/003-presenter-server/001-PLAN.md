# Presenter Server

## Goal
Add full Express.js presenter server with HTML-serving routes and REST API endpoints for session management backed by AWS S3 and Lambda.

## Success Criteria
1. GET / serves presenter/index.html
2. GET /sessions serves presenter/sessions.html
3. GET /session/:id serves presenter/session-viewer.html
4. GET /api/sessions returns all sessions from S3 with metadata
5. GET /api/session/:id returns full session data (metadata, clicks, transcript, analysis)
6. GET /api/session/:id/screenshots returns signed S3 URLs for screenshots
7. POST /api/session creates a new session (calls Lambda)
8. POST /api/session/:id/end ends a session
9. Uses AWS SDK v3
10. Runs on port 3000
11. package.json with start script exists in presenter/
