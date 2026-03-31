# Screenshot Gallery Component

## Goal
Add a screenshot gallery component at `presenter/components/gallery.js` that fetches and displays session screenshots in a grid with lightbox, navigation, annotations, and export.

## Success Criteria
1. Component at `presenter/components/gallery.js` fetches screenshots from `/api/session/:id/screenshots`
2. Lazy-loading thumbnails (200x150) using Intersection Observer
3. Click opens full-size lightbox overlay
4. Arrow keys navigate between screenshots in lightbox
5. Click annotation overlay shows what was clicked in each screenshot
6. Download button for individual screenshots
7. Export all as ZIP button
8. Dark theme consistent with existing BoothApp UI
