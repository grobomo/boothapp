# Visitor Photo Display in Session Viewer

## Goal
Show badge photo as circular avatar next to visitor name. If no photo, show initials in a name-colored circle.

## Success Criteria
1. If `badge.jpg` exists in the session S3 folder, it displays as a circular avatar
2. If no photo, initials appear in a colored circle (color derived from visitor name)
3. No regressions to existing session viewer functionality

## Analysis
- The session-viewer.html already has:
  - Circular `.visitor-avatar` CSS (border-radius: 50%, overflow: hidden)
  - `fetchS3ImageUrl(prefix + "badge.jpg")` that loads the photo
  - Initials extraction from visitor name
  - `<img>` insertion when photo found
- What's missing: **colored background** for the initials fallback (currently static gray)

## Plan
1. Add a `nameToColor()` function that hashes the visitor name to one of several accent colors
2. Apply the color as background on the avatar element when showing initials
3. Reset to neutral when photo loads successfully
