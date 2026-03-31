# Session List API Endpoint

## Goal
Add GET /sessions endpoint to the session orchestrator that returns all sessions from S3 with metadata and analysis status. Update presenter/sessions.html to fetch from this API instead of using the AWS SDK directly in the browser.

## Success Criteria
- [x] GET /sessions returns JSON array of all sessions
- [x] Each session includes: session_id, visitor_name, status, created_at, has_analysis
- [x] presenter/sessions.html fetches from the API endpoint (no browser AWS SDK)
- [x] Sorting and expand/detail functionality preserved
- [x] CORS headers allow presenter origin
