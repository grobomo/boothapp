# Session Data Integrity Checker

## Goal
Add a session data integrity checker to the watcher pipeline that validates raw session data before analysis begins.

## Success Criteria
1. Click timestamps fall within session start/end range (hard failure if outside)
2. Transcript entries have non-empty text (soft failure -- log warning)
3. No duplicate click events (soft failure -- log warning, deduplicate)
4. Metadata visitor_name is not empty (hard failure)
5. Warnings logged for soft failures
6. Session rejected for hard failures
7. Tests cover all validation rules
