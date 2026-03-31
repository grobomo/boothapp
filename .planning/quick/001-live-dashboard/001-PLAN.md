# Live Dashboard Plan

## Goal
Create a real-time session dashboard at `presenter/live-dashboard.html` -- the main TV screen for booth demos. Full-screen optimized for 55" TV, dark theme with neon accents.

## Success Criteria
1. Large clock showing current time
2. Active session indicator (pulsing green when running)
3. Live click counter polling S3 every 2s
4. Last 5 screenshots as auto-updating thumbnails
5. Live transcript preview (last 3 lines from partial transcript)
6. Session queue (waiting visitors)
7. Total sessions completed today counter
8. Full-screen optimized for 55" TV -- large fonts, high contrast, dark theme, neon accents

## Approach
- Single HTML file following existing patterns (live.html, session-viewer.html)
- Direct S3 polling via AWS SDK (same auth pattern as other pages)
- CSS Grid layout optimized for 1920x1080 landscape
- Neon accent colors (green for active, cyan for info, magenta for highlights)
- No external dependencies beyond AWS SDK already used
