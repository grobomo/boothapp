# Timeline Visualization - Summary

## What was done
- Created `presenter/components/timeline-viz.js` - reusable vertical timeline component
- Created `presenter/session-timeline.html` - standalone demo page with sidebar, filters, stats

## Component features
- Vertical center-line timeline with timestamp dots
- Click events on LEFT side with screenshot thumbnails
- Transcript events on RIGHT side with speaker labels (SE / Visitor)
- Color-coded: blue (#448AFF) clicks, green (#00E676) SE, purple (#B388FF) visitor
- Click-to-expand detail view on any card
- V1 product badges resolved from URL patterns or explicit `product` field
- Follows same export pattern as heatmap.js (browser global + CommonJS)

## Demo page features
- Session sidebar with click/transcript counts
- Filter dropdown (all, clicks, transcript, SE, visitor)
- Stats row (clicks, transcript, duration, products)
- Demo data generator with realistic SE/visitor conversation lines
- JSON import support

## Verified
- Component loads in Node (module.exports works)
- All 6 prototype methods present
- Product resolution from URL and explicit field both work
- HTML div tags balanced (21/21)
