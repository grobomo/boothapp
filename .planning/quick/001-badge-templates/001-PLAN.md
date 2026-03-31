# Badge Template System

## Goal
Add a visitor badge template system at `presenter/badge-templates.html` that allows SEs to define OCR extraction regions on conference badge photos.

## Success Criteria
1. Page loads at presenter/badge-templates.html with dark theme matching existing UI
2. User can upload a sample badge image displayed on a canvas
3. User can draw rectangles via click-and-drag on the canvas
4. Each rectangle can be labeled (name, title, company)
5. Templates are saved to localStorage as JSON
6. Templates are named by conference (e.g., "RSA 2026")
7. Saved templates can be loaded and edited
8. Template JSON contains region coordinates relative to image dimensions
9. Canvas-based drawing with visual feedback during drag
