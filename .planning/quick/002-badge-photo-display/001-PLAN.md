# Badge Photo Display in Summary Report

## Goal
Add visitor badge photo display to the analysis summary.html report. Show a circular thumbnail of badge.jpg in the visitor info header card, with a CSS-only placeholder avatar when no badge photo exists.

## Success Criteria
1. `analysis/lib/render-report.js` exports a `renderSummaryHtml()` function that generates a complete HTML report
2. If `badgePhotoUrl` is provided, the visitor info card shows a circular `<img>` thumbnail (100x100, `border-radius: 50%`, `object-fit: cover`)
3. If `badgePhotoUrl` is NOT provided, a CSS-only placeholder avatar icon is rendered (SVG silhouette or CSS shape)
4. The visitor info header card displays: photo/placeholder + visitor name + company + visit date
5. All styling is inline CSS or `<style>` block -- zero external dependencies
6. Tests verify both badge-present and badge-absent HTML output
7. Tests verify the circular styling classes/attributes are present
