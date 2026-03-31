# Comparison View

## Goal
Add a comparison view to the presenter. When 2+ sessions are selected from the sessions list, show a side-by-side comparison table: products demonstrated, key interests, session scores, follow-up actions. Highlights commonalities and differences. Dark theme consistent with other presenter pages.

## Success Criteria
1. Sessions page has checkboxes for multi-select
2. "Compare" button appears when 2+ sessions selected
3. Comparison page (compare.html) loads selected sessions via API
4. Side-by-side table shows: products demonstrated, key interests, engagement scores, follow-up actions
5. Commonalities highlighted (green) and differences highlighted (amber)
6. Dark theme matches existing sessions.html / demo.html CSS variables
7. API endpoint `/api/sessions/:id/analysis` returns structured analysis data
8. Back navigation to sessions page
