# Plan: Replay Viewer Screenshot Images

## Goal
Make the replay viewer load actual screenshot images from S3 instead of always showing mock browser frames. This is the "wow demo" for VPs -- they need to see real screenshots of what the visitor clicked, not placeholder text.

## Success Criteria
1. When S3 data is available (session ID provided), screenshot panel loads actual JPG images from `screenshots/click-NNN.jpg`
2. When using sample data (no session ID), shows mock browser frames (current behavior) as fallback
3. Image loads gracefully with loading state and error fallback
4. Screenshot image scales to fit the panel while maintaining aspect ratio
5. Click overlay indicator shows which element was clicked
6. Play/pause and timeline scrubbing still work correctly with real images

## Approach
- Modify `updateScreenshot()` to check if we have a real S3 endpoint and render an `<img>` tag with the screenshot URL
- Add CSS for screenshot images (object-fit, loading states)
- Keep mock-browser as fallback for sample data or image load errors
- Add keyboard shortcut hints to the UI
