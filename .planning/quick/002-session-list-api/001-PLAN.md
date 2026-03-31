# Session List API Endpoint

## Goal
Create GET /api/sessions on the presenter server that returns all sessions from S3 with metadata and analysis status. Add a sessions.html page that consumes this API.

## Success Criteria
1. GET /api/sessions returns JSON array of session objects
2. Each session includes: session_id, visitor_name, status, created_at, has_analysis, summary_link
3. Server reads from S3 bucket (boothapp-sessions or configured bucket)
4. presenter/sessions.html fetches from /api/sessions (no AWS creds in browser)
5. Sessions page renders a table/list of all sessions with clickable summary links
6. Server handles S3 errors gracefully
7. Package.json with express + aws-sdk dependencies
