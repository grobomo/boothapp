# Session Search & Filter Bar

## Goal
Add a search and filter bar to the presenter landing page (demo.html) that allows filtering sessions by date range, visitor company, session score range, and products demonstrated. Support text search by visitor name or company. All filtering is client-side (instant, no server round-trip). Filter state persists in URL parameters.

## Success Criteria
1. Filter bar UI renders above the activity feed with controls for: date range, company, score range, products
2. Text search input filters by visitor name or company (instant, on keyup)
3. Date range filter (start/end date inputs) filters sessions by timestamp
4. Company dropdown populated from session data
5. Score range filter (min/max) filters by session score
6. Product multi-select filters by products demonstrated
7. All filters apply client-side with no server round-trip
8. Filter state persists in URL query parameters (readable, shareable)
9. URL parameters restore filter state on page load
10. Existing accessibility tests still pass
