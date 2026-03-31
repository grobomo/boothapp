# Session Recording Simulator

## Goal
Create `scripts/simulate-session.sh` that simulates a 2-minute live demo session, writing session artifacts (metadata, clicks, transcript) incrementally so the watcher pipeline can process them in real-time. This enables demoing the live pipeline flow to judges without the Android app or Chrome extension.

## Success Criteria
1. Script creates a session directory following the S3 data contract
2. Badge metadata (badge.json) is written first
3. Click events are added one at a time at ~5-second intervals to clicks.json
4. Transcript text is generated after clicks complete
5. `ready` trigger file is written last
6. Total runtime is approximately 2 minutes
7. Output is visible/narrated so judges can follow along
8. Script is executable and works on Linux/macOS bash

## Approach
- Write a bash script that uses `sleep` + incremental JSON construction
- Follow the S3 data contract from README exactly
- Use realistic demo data (visitor, product clicks, transcript segments)
- Print colored status messages as each step happens
