# Spec: Status Badge Component for Chrome Extension Popup

## Problem Statement

The Chrome extension popup displays session status as text only. Users lack a quick visual indicator of whether a session is active or idle, requiring them to read the status text each time they check.

## Solution

Add a pulse animation to the existing status dot in `extension/popup.html`. The dot is already green when active and gray when idle. Adding a CSS keyframe animation makes the active state visually distinct at a glance -- no new elements or JS changes needed.

## Components

### 1. Pulse Animation (CSS only)
- `@keyframes pulse` that scales (1x to 1.4x) and adjusts opacity (1 to 0.7)
- Applied to `.status-dot.active` via the `animation` property
- 1.5s ease-in-out infinite loop
- No animation when idle (gray dot remains static)

### 2. Existing Infrastructure (no changes needed)
- `#sessionDot` element already toggles `.active` class via `popup.js`
- `.status-dot.active` already has green color and box-shadow
- State binding in `updateSessionStatus()` already handles session start/stop

## Success Criteria

1. Green pulsing dot visible next to status text when a session is active
2. Gray static dot visible when no session is active
3. Dot state transitions correctly when session starts/stops without popup reload
4. No external CSS or JS dependencies added
5. All changes contained within `extension/popup.html` (CSS only)
6. No visual regressions to existing popup layout

## Out of Scope

- Changes to popup.js or background.js
- New status states beyond active/idle
- Tooltip or hover behavior on the dot
- Accessibility enhancements (ARIA labels)
- Changes to any backend components
