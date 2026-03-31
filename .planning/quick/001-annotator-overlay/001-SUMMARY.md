# Annotator Overlay - Summary

## What Was Done
Created `presenter/components/annotator-overlay.js` - a reusable HTML5 Canvas annotation overlay for BoothApp screenshots.

## Features
- **Drawing tools**: pen, highlighter, text, arrow
- **Color picker**: 8 preset colors + custom color input
- **Undo/redo**: Ctrl+Z / Ctrl+Y with full stroke history
- **Keyboard shortcuts**: P/H/T/A for tools, Ctrl+S to save, Escape to close
- **Touch support**: works on tablet/touch devices
- **S3 persistence**: saves to `sessions/<id>/annotations.json`, merges per-screenshot
- **Read-only mode**: `BoothAnnotator.renderOntoImage()` for overlaying saved annotations
- **Responsive**: fits image to viewport, scales coordinates to native resolution

## Integration Points
- **session-viewer.html**: lightbox opens annotator instead of static image
- **replay.html**: lightbox opens annotator with screenshot file context
- **session-replay.html**: double-click screenshot to annotate

## S3 Data Format
```json
{
  "session_id": "SESSION-123",
  "updated_at": "2026-03-31T...",
  "annotations": {
    "screenshot_001.jpg": {
      "strokes": [
        { "tool": "pen", "color": "#ff3b30", "points": [{"x":10,"y":20},...] },
        { "tool": "text", "color": "#007aff", "points": [{"x":50,"y":50}], "text": "Important!" }
      ],
      "updated_at": "2026-03-31T..."
    }
  }
}
```
