# Session Export Feature

## Goal
Create `analysis/export.js` that packages all session data into a self-contained HTML file for email sharing. Add a "Download Report" button to the session viewer.

## Success Criteria
1. `analysis/export.js` accepts a session_id and produces a standalone HTML report
2. HTML embeds: visitor info, timeline with base64 screenshots, full transcript, analysis summary with products/scores, follow-up recommendations
3. All CSS is inline (no external dependencies)
4. CLI: `node analysis/export.js <session-id>` writes to `output/report-standalone.html`
5. Session viewer gets a "Download Report" button that triggers export
6. Tests pass
