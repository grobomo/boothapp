# Click Heatmap Visualization

## Goal
Add an HTML5 Canvas-based click heatmap component to the presenter layer that visualizes click patterns from booth demo sessions, overlaid on screenshots.

## Success Criteria
1. heatmap.js renders colored circles at click coordinates on a canvas overlay
2. Color intensity scales with click frequency (gaussian density)
3. Legend shows click count scale
4. Toggle heatmap on/off in the session viewer
5. Aggregate heatmap mode across all sessions
6. Works with the existing S3 data contract (clicks.json + screenshots/)
7. Session viewer page integrates the heatmap component

## Approach
- Create `presenter/components/heatmap.js` -- standalone Canvas heatmap renderer
- Create `presenter/session-viewer.html` -- session viewer page with heatmap integration
- Use gaussian blur for heat intensity, color gradient from blue (low) to red (high)
- Support single-session and aggregate modes
- No external dependencies -- pure HTML5 Canvas
