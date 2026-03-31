# Transcript Viewer for Presenter Session Page

## Goal
Add an interactive transcript viewer to the presenter session detail page. Show full transcript with speaker labels color-coded (SE=blue, Visitor=green), highlight portions referenced in AI analysis, and enable click-to-scroll from key interests to relevant transcript sections. Pure HTML/CSS.

## Success Criteria
1. New session detail page (`session.html`) accessible from sessions list
2. Full transcript displayed with speaker labels color-coded: SE in blue, Visitor in green
3. Transcript portions referenced in AI analysis are visually highlighted
4. Clicking a key interest auto-scrolls to the relevant transcript section
5. API endpoints serve transcript and analysis data for a session
6. Pure HTML/CSS/vanilla JS -- no frameworks
7. Consistent with existing dark theme (Trend Micro red, dark surfaces)

## Implementation
1. Add API endpoints: `/api/sessions/:id/transcript` and `/api/sessions/:id/analysis`
2. Create `session.html` with transcript viewer + analysis sidebar
3. Link sessions list to session detail page
4. Color-coded speaker labels, highlighted referenced sections, click-to-scroll
