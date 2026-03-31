# Audio Visualizer - Summary

## What was done
- Created `audio/lib/visualizer.js` with `AudioVisualizer` class
- RMS level computation from raw 16-bit PCM audio at 10Hz (100ms windows)
- `getLevel()` returns 0-100, `getPeak()` returns session max
- Silence detector warns after 30s of sub-threshold audio
- Created `audio/test-visualizer.js` with 13 unit tests (all passing)
- Added test to root `npm test` script

## Architecture
- Spawns a lightweight ffmpeg reading raw PCM at 8kHz mono (low CPU)
- Independent from the main recorder ffmpeg — no coupling
- Event-based: emits `level`, `silence-warning`, `started`, `stopped`
- Chrome extension popup can poll `getLevel()` at any rate
