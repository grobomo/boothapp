# Interactive Data Flow Diagram

## Goal
Create `presenter/dataflow.html` showing the BoothApp pipeline as connected nodes with animations.

## Success Criteria
1. File exists at `presenter/dataflow.html`
2. Opens standalone in a browser (no build step)
3. Shows all pipeline components as connected nodes:
   - Chrome Extension (content.js click capture + background.js screenshots)
   - S3 Bucket (storage)
   - Watcher (polling + session processing)
   - Pipeline (download -> transcribe -> analyze)
   - Correlator (merge clicks + transcript + screenshots)
   - Email Template Generator
   - Presenter Server (API + UI)
4. Animated data flow particles along connections
5. Interactive: click nodes for detail popups
6. Matches existing presenter styling (dark theme from demo.html)
