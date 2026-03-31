# Demo Mode - Summary

## What Was Done
Created `presenter/demo-mode.html` -- a self-running demo that simulates the full BoothApp workflow for projector presentations.

## 6-Step Sequence
1. **Badge Scan** (3s) - Animated scanning ring with sweep line and pulsing glow
2. **Visitor Info** (5s) - Sarah Chen card with avatar, title, company, interest badges
3. **Click Tracking** (5s) - Mock V1 dashboard with animated click dots appearing in real-time
4. **Audio Waveform** (5s) - 60-bar waveform animation with recording indicator and timer
5. **Analyzing** (5s) - Spinner with step-by-step progress (transcribe, analyze, match, generate)
6. **Report Card** (6s) - Scores (Interest 92, Engagement 88, Buy Signal 75) + 3 follow-up actions

## Features
- Auto-loops continuously after completing all steps
- Full-screen mode (button or F key) for projector display
- Keyboard controls: arrow keys to navigate, space to advance
- Dark theme matching existing presenter palette (#0d1117)
- Step indicator dots at bottom
- Progress bar at top
- Single self-contained HTML file (only external dep: Google Fonts)
