# Executive Briefing Generator

## Goal
Create `presenter/briefing.html` -- a one-page executive briefing that aggregates all analyzed booth sessions into KPIs and insights for leadership.

## Success Criteria
1. Single HTML file at `presenter/briefing.html` -- no external dependencies
2. Displays: total visitors, top interests, most requested products, competitor mentions, booth improvement recommendations
3. Auto-updates as new sessions are added (polling / event-driven refresh)
4. Matches existing Trend Micro / BoothApp visual branding (red/dark theme from demo.html)
5. Works with the existing session data format (sample_data.json structure)
6. Supports loading sessions via: paste JSON, file upload, or localStorage persistence
7. Demo mode with realistic sample data for testing
