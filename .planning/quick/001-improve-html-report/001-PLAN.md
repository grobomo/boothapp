# Improve HTML Report Template

## Goal
Transform the analysis pipeline HTML report into a presentation-quality document with Trend Micro branding (red/black), inline SVG logo, executive summary insight cards, detailed timeline, and recommended next steps. The report should look professional enough for an SE to hand to a VP of Security.

## Success Criteria
1. Trend Micro red (#D32F2F) and black branding throughout
2. Inline SVG of the Trend Micro logo (not a placeholder globe icon)
3. Executive summary section with 3-4 key insight cards at top
4. Detailed timeline section with timestamps showing what was demoed
5. Recommended next steps section with actionable follow-ups
6. Clean typography with system fonts
7. Responsive layout
8. Print-friendly CSS
9. All existing {{placeholder}} variables still work with render-report.js
10. Report renders correctly with sample data

## Files to Change
- `analysis/templates/report.html` - Complete template redesign
- `analysis/render-report.js` - May need new placeholder variables for insight cards

## Approach
- Redesign the template with a clean single-column layout (no sidebar) for better print/presentation
- Add real Trend Micro logo SVG inline
- Break executive summary into insight cards (duration, products, engagement, priority)
- Keep all existing placeholders compatible
- Add new placeholders if needed for the insight cards
