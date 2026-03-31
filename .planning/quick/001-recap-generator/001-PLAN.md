# Session Recap Video Generator

## Goal
Create `analysis/engines/recap_generator.py` that generates a scrolling HTML "video" recap of a completed session at `output/recap.html`. The recap presents the session as a story with autoplay.

## Success Criteria
1. Title card with visitor name and company (3s display)
2. Each click shown as a screenshot placeholder with annotation overlay, advancing every 2s
3. Key transcript quotes overlaid at relevant points
4. Final summary card with products demonstrated and scores
5. Autoplay mode that cycles through the whole session
6. Reads session data from standard data contract (metadata.json, clicks.json, transcript.json, summary.json)
7. Outputs self-contained HTML file at `output/recap.html`
8. Tests pass
