# PDF Export for Session Analysis

## Goal
Add an "Export PDF" button to the presenter's session analysis view that generates a clean one-page summary using the browser print API (`window.print()`).

## Success Criteria
1. An "Export PDF" button is visible when viewing a session analysis
2. Clicking it triggers `window.print()` with `@media print` CSS that produces a clean one-page layout
3. The printed page includes: visitor info, executive summary, top 3 key interests, top 3 follow-up actions, and session score
4. Screen-only elements (particles, animations, nav) are hidden in print
5. Print layout fits on a single page with clean formatting
