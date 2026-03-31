# Presenter CRM Export -- Summary

## What Was Done
- Added "Export to CRM" section to `presenter/analytics.html` with two download buttons:
  - **Download CSV** -- standard CSV with columns: visitor_name, company, title, session_date, products_demonstrated, key_interests, recommended_actions, session_score, follow_up_priority
  - **Salesforce Import** -- Salesforce Data Loader compatible CSV with: Last Name, First Name, Company, Title, Lead Source, Rating (Hot/Warm/Cold), Description, plus custom fields (Products_Demonstrated__c, Session_Score__c, Key_Interests__c, Recommended_Actions__c, Session_Date__c)
- Export respects active date-range filter (All Time / This Week / Today)
- Shows count of sessions with analysis data vs total
- Client-side generation (no server round-trip needed)
- Proper CSV escaping for commas, quotes, and newlines

## Design Decisions
- Priority mapping: score >= 8 = High/Hot, >= 5 = Medium/Warm, < 5 = Low/Cold
- Salesforce custom fields use `__c` suffix per SF convention
- Lead Source auto-set to "Trade Show Demo"
- Name splitting: last space-separated token = Last Name, rest = First Name
- Files download with date-stamped filenames (e.g. boothapp-crm-export-2026-03-31.csv)
