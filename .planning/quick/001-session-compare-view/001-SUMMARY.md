# Session Compare View

## Goal
Add a comparison view to the session viewer that lets judges compare two sessions side by side.

## What Was Done

### sessions.html - Compare Mode
- Added "Compare" button in header that activates compare mode
- Compare mode shows checkboxes on each session row
- Users select exactly 2 sessions, then click "Compare" to navigate to compare.html
- Compare bar shows selected session IDs and status
- Selected rows highlighted with blue accent border
- Cancel button exits compare mode

### compare.html - Enhanced Comparison
- Added **Interests Identified** section (section 5):
  - Three-column layout: Only in A / Shared / Only in B
  - Each interest card shows topic, confidence badge (high/medium/low), and evidence
  - Shared interests show side-by-side evidence with A/B color coding
  - Confidence differences highlighted when they differ between sessions
- Added **Insights** section (section 7):
  - Auto-generated aggregate patterns from both sessions
  - Score comparison (which session had stronger engagement)
  - Duration ratio analysis
  - Product coverage overlap percentage
  - Shared vs unique interests count
  - High-confidence buying signal detection
  - Combined follow-up action count
  - Color-coded insight icons (positive/neutral/warning)

### session-viewer.html - Compare Link
- Added "Compare" link in topbar navigation
- Pre-fills session A with current session ID

## Files Modified
- presenter/sessions.html
- presenter/compare.html
- presenter/session-viewer.html
