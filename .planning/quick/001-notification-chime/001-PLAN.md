# Plan: Notification Sound + Toast for Analysis Completion

## Goal
Add a notification chime (Web Audio API) and toast message to the presenter dashboard when a new session analysis completes. Creates a "wow" moment during live demos.

## Success Criteria
1. Web Audio API chime plays when analysis completes (subtle, pleasant)
2. Toast appears in bottom-right with visitor name and session score
3. Toast auto-dismisses after 5 seconds
4. Works on both demo.html (dashboard) and sessions.html (list view)
5. No external dependencies -- pure browser APIs

## Approach
- Add toast CSS + container to demo.html and sessions.html
- Create Web Audio API chime function (short sine/triangle wave chord)
- Hook into the existing polling/mock-event system to detect analysis-type events
- Show toast with slide-in animation, auto-dismiss with fade-out
- Add SSE endpoint to server.js for real-time notifications (future-ready)
