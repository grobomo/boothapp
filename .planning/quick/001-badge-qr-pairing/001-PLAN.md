# Badge + QR Pairing Fixes

## Goal
Fix gaps in Feature 3 (QR Code Pairing) and Feature 4 (Badge Scan -> Session Start) so the end-to-end flow works: extension shows QR -> mobile scans -> pairs -> badge scan -> session auto-starts -> extension detects session.

## Success Criteria
1. Extension popup has Demo PC ID and Event ID config fields in settings
2. QR payload uses integer `pc.id` (not string `pc.name`) for `demoPcId`
3. `write_active_session` message handler exists in background.js
4. `scan-and-start` validates that the requesting device is paired
5. All existing tests pass
6. New test coverage for the fixed behaviors

## Tasks
- [x] Add demoPcId/eventId fields to popup settings UI
- [x] Fix QR payload demoPcId to use pc.id
- [x] Add write_active_session handler to background.js
- [x] Add pairing validation to scan-and-start
- [x] Add tests for new/fixed behaviors
- [x] Run all tests
