# Admin Management Console

## Goal
Create a management console at presenter/admin.html with admin.js that provides session management, system status, and activity logging for booth operators.

## Success Criteria
- [ ] Session management table: all sessions, sortable by date/status/score
- [ ] Delete session button: removes session from S3
- [ ] Re-trigger analysis button: re-runs pipeline for a session
- [ ] System status panel: watcher status, S3 usage, Lambda invocations
- [ ] Worker fleet status (if fleet API accessible)
- [ ] Activity log: last 50 events (session created, analysis completed, errors)
- [ ] Admin password required (ENV-based or S3 auth)
- [ ] Dark theme, table-based layout
- [ ] Consistent with existing presenter pages (same design language)
