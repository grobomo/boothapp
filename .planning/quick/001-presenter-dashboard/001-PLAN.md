# Presenter Dashboard

## Goal

Create a tablet-friendly presenter dashboard at `analysis/templates/presenter.html` for the SE to use during live demos. The dashboard provides real-time session monitoring and control.

## Success Criteria

1. Dashboard renders at `analysis/templates/presenter.html` as a standalone HTML file
2. Shows current session status (recording / processing / complete) with visual state indicators
3. Displays live click count updated via S3 polling
4. Shows audio level indicator placeholder (visual bar, not functional audio)
5. Shows elapsed time as a running timer
6. Has a prominent STOP SESSION button that is easy to tap on a tablet
7. On session complete: displays engagement score and top 3 products demonstrated
8. Polls S3 every 5 seconds for session status updates
9. Tablet-friendly: large touch targets, responsive layout, readable at arm's length
