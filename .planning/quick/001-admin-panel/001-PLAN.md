# Admin Panel

## Goal
Build a comprehensive admin panel at `presenter/admin.html` that replaces the current User Management page with a full system operations dashboard.

## Success Criteria
1. View all sessions with status (active/completed/failed) in a sortable, filterable table
2. Delete failed sessions via the API
3. Re-trigger analysis for a session
4. View watcher status (last poll time, sessions in queue)
5. View S3 bucket usage stats
6. Manual session creation form (for testing)
7. Dark theme consistent with existing presenter pages
8. Table-based layout with sort/filter
9. Uses fetch() to call existing API endpoints
10. Auth-gated (admin role required)
