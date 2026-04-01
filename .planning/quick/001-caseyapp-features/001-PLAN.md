# CaseyApp Feature Implementation

## Goal
Implement the CaseyApp system as described in the feature document: management server with event/badge/session/user management, update Chrome extension to connect to management server, add packager service for audio+packaging, and wire presenter dashboard to real data.

## Success Criteria
1. Management server runs on port 4000 with SQLite DB
2. Event CRUD API (create, list, set active)
3. Badge training API (upload samples, AI extraction, field correction)
4. Device pairing via QR code generation
5. Session lifecycle API (create, end, stop-audio)
6. User management with auth (admin/user roles, forced password change)
7. Contact CSV import and AI matching
8. Chrome extension renamed to CaseyApp, connects to management server
9. Packager service on port 9222 (audio recording, packaging, S3 upload)
10. Presenter dashboard wired to real session data
11. All existing tests continue to pass
12. Brand compliance (TrendAI colors, Inter/Work Sans fonts)

## Approach
Build the management server as the central component since everything depends on it. Then update extension and packager to connect to it. Keep existing analysis pipeline intact.

## Components to Build
1. `management/` - Express + SQLite management server
2. Update `extension/` - Rename to CaseyApp, connect to management server
3. `packager/` - Node.js packager service
4. Update `presenter/` - Wire to real APIs
