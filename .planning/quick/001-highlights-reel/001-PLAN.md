# Highlights Reel — Presentation Page

## Goal
Create `presenter/highlights.html` — a full-screen, dark-themed presentation page that auto-curates the best moments from all demo sessions for the hackathon presentation.

## Success Criteria
1. Page at presenter/highlights.html loads and fetches all sessions from S3
2. Six slide sections navigable via arrow keys:
   - Top 5 sessions by engagement score with visitor cards
   - Best screenshots (most annotated clicks)
   - Best follow-up email generated
   - Most products demonstrated in a single session
   - Longest transcript (most engaged visitor)
   - Competitive mentions summary
3. Full-screen layout optimized for projector display
4. Dark theme with large text matching existing boothapp style
5. Data auto-populated from S3 session data (metadata.json, summary.json, clicks.json, transcript.json, follow-up-email.html)
6. Keyboard navigation (left/right arrows) between sections
7. Uses existing auth.js pattern for AWS credentials
