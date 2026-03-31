# Session Recording Simulator -- Summary

## What was done
Created `scripts/simulate-session.sh` that simulates a 2-minute live booth demo session.

## How it works
1. **Phase 1 (Badge Scan)**: Writes `badge.json` with visitor metadata
2. **Phase 2 (Click Capture)**: Adds 15 click events one at a time at 5-second intervals to `clicks.json`, with placeholder screenshots
3. **Phase 3 (Transcript)**: Writes a 16-segment conversation transcript (realistic SE/visitor healthcare demo dialogue)
4. **Phase 4 (Trigger)**: Writes the `ready` file last, signaling the watcher pipeline

## Verification
- All output files are valid JSON (badge.json, clicks.json, transcript.json)
- Follows the S3 data contract from README exactly
- 15 screenshots created as `click-NNN.jpg`
- `ready` trigger file written last
- Total runtime ~80 seconds (15 clicks x 5s + pauses)
- Colored output with narration for judge-facing demo
