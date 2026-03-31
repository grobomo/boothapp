# QR Code Pairing & Auto-Session Start

## Goal
Enable the Android app to auto-connect to the Chrome extension via QR code and auto-start sessions on badge capture.

## Success Criteria
- [ ] Chrome extension popup has a "Show QR Code" button that generates a QR code containing S3 config + demo PC info
- [ ] Android app can scan the QR code (new activity) and auto-fill all connection settings
- [ ] Badge capture (successful OCR) auto-triggers session start without needing to tap "Start Session"
- [ ] QR code contains: S3 bucket, region, presign endpoint, AWS credentials, demo PC name
- [ ] Connection info persists in AppPreferences after QR scan

## Approach
1. **Extension**: Add QR code generation to popup using a lightweight JS QR library (inline, no npm). QR encodes JSON with S3 config.
2. **Android**: Add QR scanner activity using ML Kit barcode scanning (already have ML Kit for OCR). Parse JSON, save to AppPreferences.
3. **Android**: After successful OCR badge capture, auto-call startSession() instead of just enabling the button.

## Files Changed
- `extension/popup.html` - Add QR code display area and button
- `extension/popup.js` - Add QR generation logic
- `extension/qrcode.min.js` - Lightweight QR library (qrcode-generator, MIT)
- `android/app/src/main/java/com/trendmicro/boothapp/ui/QrScanActivity.kt` - New QR scanner
- `android/app/src/main/java/com/trendmicro/boothapp/ui/MainActivity.kt` - Auto-session on badge capture, QR scan button
- `android/app/src/main/AndroidManifest.xml` - Register QrScanActivity
- `android/app/src/main/res/layout/activity_main.xml` - Add QR scan button
- `android/app/build.gradle.kts` - Add barcode scanning dependency
