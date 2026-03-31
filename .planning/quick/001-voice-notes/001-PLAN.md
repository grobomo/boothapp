# Voice Notes Feature

## Goal
Add a voice notes (text annotation) feature to BoothApp. During a session, the SE presses Ctrl+Shift+N to add a timestamped text note. Notes are stored in clicks.json events array with type='note' and appear in the analysis report as SE annotations.

## Success Criteria
1. Ctrl+Shift+N hotkey triggers a note input prompt in the Chrome extension
2. Notes stored in clicks.json events array with type='note', timestamp, and text
3. Notes appear in the analysis report as SE annotations
4. Simulate-session.sh includes sample note events
5. Tests cover note event handling in report generation
