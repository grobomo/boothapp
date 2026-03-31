# Visitor Sentiment Timeline in Session Viewer

## Goal
Add a color-coded sentiment timeline bar to the dashboard.html session viewer, displaying emotional indicators (positive, neutral, hesitation, skepticism) tracked throughout the transcript.

## Success Criteria
1. Dashboard.html renders a color-coded sentiment timeline bar from summary.json sentiment_timeline data
2. Four sentiment types shown: positive (green), neutral (blue), hesitation (yellow), skepticism (red)
3. Bar segments show timestamps and tooltips with indicator text and speaker quotes
4. Legend below the bar identifies each color
5. Detail rows below legend show each sentiment entry with timestamp, indicator, and quote
6. Works with existing summary.json schema (no backend changes needed -- data already produced by analyze.py)

## Approach
- The sentiment_timeline field is already produced by the analysis pipeline and included in summary.json
- The HTML report template already has _build_sentiment_bar() and CSS -- reuse that design in dashboard.html
- Add a new card section to dashboard.html between the timeline and follow-ups sections
- Render sentiment data client-side from the loaded summary.json
