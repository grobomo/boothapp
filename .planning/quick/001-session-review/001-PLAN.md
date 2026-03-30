# Session Review UI

## Goal
Create a post-demo session review page at `demo/review.html` that lets an SE review the AI analysis output before sending it to the visitor.

## Success Criteria
1. Page accepts session ID via URL param (`?session=XXX`)
2. Fetches `output/summary.json` and `output/summary.html` from S3
3. Displays HTML report in an iframe
4. Shows key metrics: products shown, visitor interests, recommended follow-ups
5. Has an "Approve & Send" button (placeholder action)
6. Dark theme matching existing dashboard/report pages (CSS variables from dashboard.html)
7. PR to main branch
