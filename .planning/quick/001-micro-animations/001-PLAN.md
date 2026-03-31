# Micro-Animations for Presenter UI

## Goal
Add micro-animations to all presenter UI elements in briefing.html and demo.html: fade-in cards, count-up numbers, staggered list items.

## Success Criteria
1. Cards fade in on page load / render with staggered delays
2. Numeric KPI values animate from 0 to target (count-up)
3. List items (bars, recommendations, pills, products, feed) appear with staggered delays
4. Animations are CSS-driven where possible, JS for count-up
5. No external dependencies added
6. Print styles unaffected
7. Both briefing.html and demo.html updated

## Approach
- CSS: `@keyframes fadeInUp` with `animation-delay` via inline styles or nth-child
- JS: `countUp()` function that animates number from 0 to target over ~1s
- JS: IntersectionObserver not needed (single-page dashboards, all visible)
- Stagger via CSS custom property `--delay` set per element index
