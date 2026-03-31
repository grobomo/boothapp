# Presenter Landing Page

## Goal
Create a presenter landing page at `presenter/index.html` that shows a grid of completed sessions from S3, with session scores, auto-refresh, and dark theme.

## Success Criteria
1. Grid of cards showing: visitor name, company, session score (color-coded), link to full analysis
2. Score color coding: green 8-10, yellow 5-7, red 1-4
3. Auto-refresh every 30 seconds
4. Dark theme, modern CSS consistent with existing presenter pages
5. Fetches session data from the existing `/api/sessions` endpoint
6. Only shows completed/analyzed sessions (not active ones)
7. Responsive layout

## Approach
- Replace existing `presenter/index.html` with new grid-based landing page
- Reuse existing API endpoint `/api/sessions` which already returns session data including `session_score` from summary.json
- Keep existing nav, auth, error-boundary, shortcuts includes
- Status bar at top showing counts (preserved from current page)
