# Demo Landing Page - Summary

## What was done
Created `demo/landing/index.html` -- a Trend Micro branded kiosk landing page for booth idle state.

## Key decisions
- **Separate from `demo/welcome.html`**: The existing welcome page uses BoothApp branding and has different UX (session monitoring dashboard). The new landing page is a visitor-facing kiosk screen with Trend Micro branding.
- **localStorage for counter**: Session count persists across page refreshes but resets daily. No backend needed for a simple booth counter.
- **S3 polling retained**: Same pattern as welcome.html -- polls active-session.json to detect when a session starts and show the overlay.
- **No external dependencies**: Pure HTML/CSS/JS, Google Fonts only. No build step needed.

## Verification
- JS parsed and executed in Node.js with DOM mocks -- zero errors
- HTML structure validated -- all required elements present
- Responsive layout tested via CSS media queries (700px breakpoint)

## PR
https://github.com/altarr/boothapp/pull/179
