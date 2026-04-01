# Summary: Badge Scan -> Auto-Session + QR Pairing

## What Was Done

### Feature 3: QR Code Pairing
- **POST /api/pair** - Mobile app pairs with demo PC after scanning QR code
- **GET /api/pair/status/:demoPcId** - Extension polls for paired mobile device
- **DELETE /api/pair/:demoPcId** - Unpair a device
- **Extension popup** - QR code display section with live pairing status polling
- **DB schema** - Added `pairings` table (event_id, demo_pc_id unique, device_id, device_name)

### Feature 4: Badge Scan -> Session Auto-Start
- **POST /api/badges/scan-and-start** - Badge image + visitor info -> auto-creates session + writes active-session.json to S3
- Extension and packager already poll S3 for active sessions, so they auto-detect and begin capture

### Tests
- 8 new pairing tests (pair, status, re-pair/upsert, unpair)
- 6 new badge-scan-and-start tests (creates session, returns correct fields, session exists in DB)
- All 67 management tests pass, full suite passes

## Files Changed
- `management/db.js` - Added pairings table schema
- `management/routes/pair.js` - New pairing routes
- `management/routes/badges.js` - Added scan-and-start endpoint
- `management/server.js` - Wired pair routes (was already present)
- `management/test/management.test.js` - Tests for pairing + scan-and-start (were already present)
- `extension/popup.html` - QR pairing UI section with CSS
- `extension/popup.js` - QR loading and pairing status polling logic
