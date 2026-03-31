# Coverage Matrix

## Goal
Create `presenter/coverage.html` — a visual heatmap showing V1 product module coverage across sessions: demonstrated (yes/no), visitor interest level, follow-up relevance.

## Success Criteria
1. Page lists all 10 V1 modules: XDR, Endpoint, Email, Network, Cloud, Risk Insights, Workbench, Threat Intel, ASRM, Zero Trust
2. Matrix rows = sessions, columns = modules
3. Each cell shows: demonstrated (boolean), interest level (0-5), follow-up relevance (0-5)
4. CSS gradient heatmap coloring (green = high, red/gray = low/none)
5. Loads session data from S3 summary.json files (same pattern as other presenter pages)
6. Matches existing dark theme and nav component
7. Mobile responsive via shared mobile.css
