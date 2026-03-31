# Skeleton UI Loading States

## Goal
Add professional loading skeleton UI to all presenter page sections so the UI feels polished during data loading instead of showing empty/blank areas.

## Success Criteria
1. `presenter/components/skeleton.js` exists with SkeletonLoader class (show/hide methods)
2. Animated pulsing gray placeholder elements for text, cards, tables, images
3. Auto-inject skeleton into containers with `data-skeleton="true"` attribute
4. Smooth fade transition from skeleton to real content
5. Error state with retry button when data fetch fails
6. Applied to: status cards, activity feed, ring chart/analytics, product list (top products)
