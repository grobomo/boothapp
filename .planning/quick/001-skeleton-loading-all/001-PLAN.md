# Skeleton Loading for All Presenter Pages

## Goal
Add shimmer skeleton animations to all presenter pages (demo.html, sessions.html) so users see placeholder content while data loads from S3.

## Success Criteria
1. demo.html: Cards show skeleton shimmer for values/labels; feed shows skeleton rows
2. sessions.html: Table shows skeleton rows instead of plain "Loading..." text; status bar counts shimmer
3. All skeletons use consistent shimmer animation (same CSS keyframes + gradient)
4. Skeletons removed and real content fades in smoothly when data loads
5. No regressions -- existing functionality unchanged
