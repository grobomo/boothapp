# Session Timeline Visualization

## Goal
Add a session timeline component to the presenter that visualizes the full duration of a booth demo session -- click events as markers, transcript segments as colored bars, with hover tooltips for details and screenshots.

## Success Criteria
1. Horizontal timeline bar spans the full session duration
2. Click events appear as markers on the timeline at correct positions
3. Transcript segments appear as colored bars below the timeline
4. Hovering a click marker shows click details and screenshot thumbnail
5. Hovering a transcript bar shows the dialogue text
6. Pure HTML/CSS/JS -- no external dependencies
7. Matches existing BoothApp dark theme (CSS variables)
8. Works with mock data when no API is available
9. Component is self-contained in `presenter/components/timeline.js`

## Approach
- Create `presenter/components/timeline.js` as an IIFE component (same pattern as search.js)
- Inject CSS via JS (same pattern as search.js)
- Use mock session data with realistic timestamps, clicks, and transcript segments
- Mount in demo.html with `new BoothTimeline({ container: '#timeline-mount' })`
- Timeline bar: CSS flexbox/positioning, markers as absolute-positioned elements
- Tooltips: positioned divs shown on mouseenter, hidden on mouseleave
