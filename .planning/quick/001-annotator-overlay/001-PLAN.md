# Annotator Overlay

## Goal
Add a session notes and annotations layer to BoothApp. SEs can draw annotations (pen, highlighter, text, arrows) on screenshots during demo review. Annotations saved to S3 and visible in replay/share views.

## Success Criteria
1. `presenter/components/annotator-overlay.js` exists with HTML5 Canvas overlay
2. Floating toolbar with pen, highlighter, text, arrow tools
3. Color picker for annotation tools
4. Undo/redo support
5. Annotations saved to S3 at `sessions/<id>/annotations.json`
6. Annotations visible in session-viewer lightbox, replay, and share views
7. Canvas overlay renders on top of screenshots without breaking existing functionality
