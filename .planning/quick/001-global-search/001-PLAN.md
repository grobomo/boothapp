# Global Search Feature

## Goal
Add a global search component at `presenter/components/search.js` that enables searching across all session data with keyboard shortcut, debounced input, localStorage history, and result navigation.

## Success Criteria
1. Search bar in navigation searches visitor name, company, session ID
2. Search transcript content (e.g. "looking for XDR")
3. Search follow-up actions
4. Results shown as dropdown with context snippets
5. Click result navigates to session viewer
6. Recent searches stored in localStorage
7. Ctrl+K keyboard shortcut to focus search
8. Debounced input (300ms)
9. Fetches from /api/sessions, filters client-side

## Approach
- Create `presenter/components/search.js` as a self-contained module
- Add search bar HTML/CSS into demo.html header
- Wire up the component with a `<script src>` tag
- Since there's no server with /api/sessions, generate mock session data that matches the sample_data.json format for the demo, with a fetch wrapper that falls back to mock data
