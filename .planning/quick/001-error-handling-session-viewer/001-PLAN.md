# Error Handling & User-Friendly Error States for Session Viewer

## Goal
Add comprehensive error handling and user-friendly error states to the session viewer (presenter/session-viewer.html). All error states must be visually consistent with the existing dark theme.

## Success Criteria
1. When S3 is unreachable, a styled "Connection Lost" banner appears with a retry button
2. Missing data (no transcript, no clicks, no screenshots) shows clear placeholder cards explaining what's missing
3. Analysis-in-progress state shows an animated progress indicator with estimated time
4. A connection status indicator (green dot = connected, red = disconnected) is visible in the header
5. All error states use the same dark theme CSS variables as demo.html
6. The page is self-contained (single HTML file, no external dependencies)
