# QR Device Pairing - Implementation Plan

## Goal

Implement Feature 3 (Device Pairing via QR Code) from the CaseyApp Feature Document. The Chrome extension must connect to the management server at caseyapp.trendcyberrange.com, register as a demo PC for the active event, and generate a branded QR code for phone pairing.

## Success Criteria

1. Extension connects to management server at caseyapp.trendcyberrange.com
2. Extension registers as a demo PC for the active event
3. Extension fetches QR payload from GET /api/demo-pcs/:id/qr-payload
4. QR code uses TrendAI red (#d71920) with logo overlay
5. QR code contains: managementUrl, eventId, demoPcId, badgeFields, eventName
6. Uses qrcode npm package for QR generation
7. Error correction level H for logo overlay compatibility
8. Extension popup shows QR code and management server connection status

## Implementation

1. Add qrcode library (browser bundle) to extension
2. Add management server connection UI to popup (server URL, demo PC name)
3. Add registration flow: connect to server, get active event, register demo PC
4. Fetch QR payload from /api/demo-pcs/:id/qr-payload
5. Generate branded QR code with #d71920 color and logo overlay
6. Display QR code in popup for phone scanning
