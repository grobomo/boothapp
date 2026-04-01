# Badge Scan -> Auto-Session + QR Pairing

## Goal
Implement QR code pairing (Feature 3) and badge scan -> session auto-start (Feature 4) for the CaseyApp booth demo system.

## Success Criteria
1. Chrome extension generates branded QR code with event config (demo PC + event ID)
2. Android app can scan QR to pair with a demo PC (API endpoint exists)
3. Badge scan via management server triggers OCR extraction and auto-starts a session
4. Extension and packager detect active session and begin capture
5. All existing tests continue to pass
6. New tests cover QR pairing, badge-scan-to-session, and mobile pairing flows

## Components

### Feature 3: QR Code Pairing
- **Management API**: GET /api/demo-pcs/:id/qr-payload (exists), GET /api/demo-pcs/:id/qr-image (exists)
- **New**: POST /api/pair - mobile app sends pairing request after scanning QR
- **New**: GET /api/pair/status/:demoPcId - extension polls for paired mobile device
- **Extension**: Display QR code in popup, poll for paired device

### Feature 4: Badge Scan -> Session Auto-Start
- **New**: POST /api/badges/scan-and-start - badge image -> OCR -> create session automatically
- **Management**: Wire badge scan result into session creation
- **Extension + Packager**: Already poll active-session.json on S3 (no changes needed)

## Implementation Order
1. Add pairing routes to management server (pair.js)
2. Add badge-scan-to-session endpoint
3. Update extension popup to show QR and pairing status
4. Add tests for new endpoints
