# Session Search & Filter Feature

## Goal
Add client-side search, filtering, sorting, and pagination to the sessions list page (presenter/sessions.html), plus a Quick Create button for test sessions.

## Success Criteria
1. Search bar filters sessions by visitor name, company, or session ID (instant, client-side)
2. Status filter dropdown with options: All, Active, Completed, Failed
3. Date range picker: Today, This Week, Custom
4. Sort options: Newest First, Highest Score First, Longest Duration
5. Pagination at 20 sessions per page with page controls
6. Quick Create button that POSTs to /api/session with sample data
7. All filtering/sorting/pagination works client-side after initial load
8. UI matches existing dark theme design language

## Approach
- Single file edit to presenter/sessions.html
- Add toolbar section with search, filters, sort, and Quick Create button
- Add pagination controls below the table
- All logic in vanilla JS (no frameworks) matching existing code style
