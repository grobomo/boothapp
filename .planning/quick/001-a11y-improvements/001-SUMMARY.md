# Accessibility Improvements - Summary

## What Was Done

### Color Contrast (WCAG 2.1 AA)
- Changed `--text-dim` from `#6B7385` to `#8B93A5`
- Before: 4.21:1 on `#06080C` bg (FAIL), 3.97:1 on `#0E1118` surface (FAIL)
- After: 6.50:1 on `#06080C` bg (PASS), 6.13:1 on `#0E1118` surface (PASS)

### Skip-to-Content Link
- Added skip link targeting `#main-content`
- Visually hidden until focused, styled with red background

### ARIA Labels
- Cards region: `aria-label="Dashboard statistics"`
- Each card: role="group" with descriptive aria-label
- Live values: `aria-live="polite"` on card values and feed list
- Feed section: `aria-label="Live activity feed"`
- Side panels: aria-label on Pipeline and Top Products regions
- Clock: `aria-label="Current time"`

### Decorative Elements Hidden
- `aria-hidden="true"` on canvas, bg-grid, bg-glow, live-dot, card icons
- Panel SVG icons marked `aria-hidden="true"`

### SVG Alt Text
- Logo SVG: `role="img" aria-label="BoothApp logo"`
- Card icon SVGs: `<title>` elements (Sessions/Demos/Reports icon)
- Ring chart SVG: `role="img"` with descriptive aria-label

### Semantic HTML
- `<main id="main-content">` wraps page content
- `<footer>` with `role="contentinfo"` replaces generic `<div>`
- `<h2>` replaces `<div>` for feed title and panel titles

### Focus Styles
- `*:focus-visible` outline on all focusable elements
- Skip link focus state with white outline

### Tests
- 30 axe-pattern accessibility tests in `presenter/test-a11y.js`
- All pass
