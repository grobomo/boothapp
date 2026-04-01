# Feature 8: Session Import + Review

## Goal
Build a presenter UI page to import completed sessions from S3, review AI analysis results, view click timeline with screenshots, and approve follow-up content before sending.

## Success Criteria
1. New `session-import.html` page with import functionality
2. API endpoint to import/re-import session data from S3
3. Review workflow: view AI summary, click timeline, screenshots
4. Approve/reject follow-up content with status tracking
5. Integration with existing sessions API and S3 cache
6. Feature task status updated to reflect completion

## Approach
- Add `/api/sessions/:id/review` endpoint for review status management
- Add `/api/sessions/:id/approve` endpoint for approval workflow
- Create `session-import.html` with:
  - Session list with import status
  - Detail view showing AI analysis summary
  - Click timeline with screenshot thumbnails
  - Approval controls (approve/reject/edit follow-up)
- Update feature-tasks.js status for Feature 8

## Files to Create/Modify
- `presenter/session-import.html` (new) - Import + review UI
- `presenter/lib/review.js` (new) - Review/approval API routes
- `presenter/server.js` (modify) - Mount review router
- `presenter/lib/feature-tasks.js` (modify) - Update Feature 8 status
