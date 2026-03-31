# Management Server Implementation

## Goal
Build the CaseyApp management server (Node.js/Express + SQLite) at `management/` that serves as the central control plane for events, badge training, device pairing, session lifecycle, contact matching, and user auth.

## Success Criteria
1. Management server starts on port 4000, serves API + dashboard UI
2. Event CRUD: create/list/update/delete events, set active event
3. Badge training: upload sample badge images, Claude Vision extraction, field correction, profile save
4. Demo PC registration: register PCs to events, generate QR pairing payloads
5. Badge scanning endpoint: POST /api/badges/scan accepts photo + event ID, returns extracted fields using trained profile
6. Session lifecycle: create session (writes metadata + active-session to S3), end session (writes end command, deletes active-session), stop-audio command
7. Session import: scan S3 for completed packages, import into DB
8. Contact CSV import: upload CSV, auto-detect columns, store in DB linked to event
9. AI matching: match session visitors to contacts via Claude
10. User auth: admin/admin default, forced password change, session-based auth, PBKDF2-SHA512
11. TrendAI brand compliance: dark theme, red/amber gradients
12. All existing components (extension, app, packager) can connect to management server endpoints
