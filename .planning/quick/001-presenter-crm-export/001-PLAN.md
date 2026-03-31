# Presenter CRM Export

## Goal
Add "Export to CRM" button to the presenter analytics page that generates downloadable CSV and Salesforce-compatible import files from loaded session data.

## Success Criteria
1. "Export to CRM" button visible on the analytics page
2. CSV download with columns: visitor_name, company, title, session_date, products_demonstrated, key_interests, recommended_actions, session_score, follow_up_priority
3. Salesforce-compatible import format download
4. Both files download directly as files (client-side generation, no server round-trip)
5. Exports respect the active date-range filter (All Time / This Week / Today)
6. Works with existing S3-loaded session + summary data
