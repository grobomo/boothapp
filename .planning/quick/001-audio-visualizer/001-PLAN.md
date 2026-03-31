# Audio Level Visualizer

## Goal
Add audio level visualization to the audio recorder so the Chrome extension popup can show a live audio meter during recording, plus silence detection for dead mic debugging.

## Success Criteria
1. `audio/lib/visualizer.js` exists and connects to the ffmpeg audio stream
2. Computes RMS levels from raw audio data
3. `getLevel()` returns 0-100 integer
4. Updates at 10Hz (100ms intervals)
5. Stores peak level for the session via `getPeak()`
6. Silence detector: logs warning if audio below threshold for 30s
7. Unit tests pass
