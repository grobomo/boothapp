# Visitor Photo Display

## Goal
Add a visitor photo avatar to the HTML session report. Show badge.jpg as a circular photo when available, fall back to colored initials circle.

## Success Criteria
1. If `badge_photo_url` is provided in data, render circular photo avatar in report header next to visitor name
2. If no photo URL, render initials in a colored circle derived from visitor name
3. Avatar has subtle drop shadow and border effect
4. Existing tests still pass
5. New tests cover both photo and initials cases
