# Demo Statistics Page

## Goal
Add a demo statistics dashboard at `presenter/stats.html` that aggregates data across all booth sessions from S3 and displays it on a dark-themed, large-font booth display.

## Success Criteria
1. Page loads at `presenter/stats.html`
2. Shows aggregate stats: total sessions, average duration, most demonstrated products (bar chart via CSS), top visitor interests, average engagement score, busiest time slots (heatmap)
3. Reads session data from S3 via AWS SDK
4. Auto-refreshes every 30 seconds
5. Dark theme with large fonts matching existing presenter pages
6. Works as a standalone HTML file (no build step)
