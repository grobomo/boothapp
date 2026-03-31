# Timeline Visualization Component

## Goal
Create `presenter/components/timeline-viz.js` -- a vertical timeline component that displays session events (clicks and transcript segments) chronologically with color-coded cards, expandable details, screenshot thumbnails, speaker labels, and V1 product module badges.

## Success Criteria
1. File exists at `presenter/components/timeline-viz.js`
2. Renders a vertical center-line timeline with timestamps
3. Click events appear as cards on the LEFT with screenshot thumbnail
4. Transcript events appear as cards on the RIGHT with speaker label
5. Color coding: blue (#448AFF) for clicks, green (#00E676) for SE speech, purple (#B388FF) for visitor speech
6. Clicking any card expands/collapses detail view
7. Product badges show which V1 module was active (extracted from URL or metadata)
8. Component follows same pattern as heatmap.js (constructor, public API, browser+Node export)
9. Integrated into session-viewer.html as a tab/view option
10. Works with demo data (no S3 dependency for testing)
