# Health Dashboard Widget

## Goal
Create a small, always-visible health widget at presenter/components/health-widget.js that shows system health (S3, watcher, Lambda) in the bottom-left corner of all presenter pages.

## Success Criteria
1. Widget renders as a colored dot (green/yellow/red) in bottom-left corner
2. Hover/click expands to show: S3 status, watcher status, Lambda status, last session time, error count
3. Auto-refreshes every 10 seconds
4. Minimizable to just the dot
5. Optional subtle sound on status change
6. Widget is a standalone JS file that can be included via `<script>` in any page
7. Added to all 3 presenter pages (demo.html, admin.html, sessions.html)

## Approach
- Single self-contained JS file that injects its own CSS and DOM
- Fetches /api/watcher/status, /api/storage/stats, /api/sessions for health data
- Add a new /api/health endpoint to server.js that aggregates all health checks into one call
- Include the widget script tag in all 3 HTML pages
