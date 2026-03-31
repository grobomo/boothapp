# Presenter Landing Page — Summary

## What Changed
Replaced the hub-style `presenter/index.html` with a session dashboard that displays completed sessions as a card grid.

## Features
- Card grid showing visitor name, company, session score (color-coded), and executive summary
- Score badge: green (8-10), yellow (5-7), red (1-4), grey (no score)
- Status bar: active/completed/total counts + average score
- Auto-refresh every 30 seconds with countdown badge
- Dark theme consistent with existing presenter pages
- Quick nav links to other pages (table view, live monitor, analytics, etc.)
- Fetches from `/api/sessions` then `/api/sessions/:id` for analysis scores
- Cards link to session-viewer.html for full analysis
- Responsive: single column on mobile, auto-fill grid on desktop

## Files Changed
- `presenter/index.html` — complete rewrite from hub page to session card grid
