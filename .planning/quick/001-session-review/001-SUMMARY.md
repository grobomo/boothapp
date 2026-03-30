# Session Review UI -- Summary

## What Was Done
- Created `demo/review.html` -- a session review page for SEs to review AI analysis output before sending to visitors
- Dark theme matching existing dashboard.html and render-report.html (same CSS variable palette)
- Two-panel layout: left = HTML report in sandboxed iframe, right = metrics sidebar

## Features
- Accepts URL params: `?session=XXX&bucket=YYY&region=ZZZ`
- Config overlay when bucket/session not provided
- Fetches `output/summary.json` for structured metrics
- Loads `output/summary.html` into iframe for full report view
- Sidebar shows: session score, executive summary, products shown, visitor interests, recommended follow-ups
- "Approve & Send" button with placeholder action (shows toast notification)

## Branch
`feature/session-review/review-page` pushed to origin.

## PR
Push succeeded but `gh auth` is not available in this environment. PR needs to be created manually or from a session with GitHub CLI access.
