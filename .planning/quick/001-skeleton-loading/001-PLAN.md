# Skeleton Loading States for Presenter Dashboard

## Goal
Add shimmer skeleton loading placeholders to all sections of demo.html that replace the initial empty/zero state with content-shaped animated placeholders during data fetch.

## Success Criteria
1. Cards show skeleton placeholders (shimmer rectangles matching card-value and card-label shapes) before first data render
2. Activity feed shows skeleton feed items (dot + text lines) before first render
3. Ring chart panel shows skeleton circle + legend placeholders
4. Products panel shows skeleton product rows (rank + bar + count shapes)
5. Shimmer animation uses a left-to-right gradient sweep
6. Skeletons disappear and real content fades in after fetchData/renderAll completes
7. No visual regression -- existing styles and animations preserved
