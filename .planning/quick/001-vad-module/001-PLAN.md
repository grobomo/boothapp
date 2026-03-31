# VAD Module Implementation

## Goal
Add a Voice Activity Detection module at `audio/lib/vad.js` that detects speech vs silence using Web Audio API, emits events, tracks durations, and produces `speech_activity.json` for S3 upload.

## Success Criteria
1. `audio/lib/vad.js` exists with VAD class using Web Audio AnalyserNode + RMS energy
2. Configurable threshold (default -40dB)
3. Emits `speechStart` and `speechEnd` events with timestamps
4. Tracks total speech duration and silence duration
5. Calculates talk ratio (speech / total)
6. Stores speech segments as `[{start, end, duration}]`
7. Produces `speech_activity.json` structure for S3 upload
8. Unit tests pass
9. PR created to main
