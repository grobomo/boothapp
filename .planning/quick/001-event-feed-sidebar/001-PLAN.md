# Event Feed Sidebar

## Goal
Add a live event feed sidebar to the session viewer that shows a chronological log of all captured events (clicks, transcript segments, screenshots, analysis stages) with timestamps and auto-scroll.

## Success Criteria
1. Toggle button in topbar opens/closes a right-side panel
2. Events shown chronologically with timestamps relative to session start
3. Each event type has distinct icon/color (click=blue, transcript=green, screenshot=purple, analysis=yellow, session=red)
4. Filter buttons to show/hide event types
5. Auto-scrolls to bottom as new events appear
6. Event count badge on toggle button
7. Responsive: full-width on mobile, 300px on tablet, 360px on desktop
8. Status bar shows live/ended state

## Implementation
- CSS: Already added to session-viewer.html
- HTML: Add toggle button in topbar, sidebar panel after #app
- JS: Build event list from clicks/transcript/metadata, render into feed, wire filters + toggle + auto-scroll
