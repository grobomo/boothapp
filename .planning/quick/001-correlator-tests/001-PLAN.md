# Correlator Test Suite

## Goal
Create comprehensive test suite for `analysis/lib/correlator.js` covering all timeline merge scenarios, plus the correlator module itself.

## Success Criteria
1. `analysis/lib/correlator.js` exists with timeline merge logic (clicks + transcript + screenshots)
2. `tests/fixtures/` contains sample click, transcript, and screenshot data
3. `tests/unit/test-correlator.js` has tests for:
   - Empty clicks + empty transcript = empty timeline
   - Clicks only = timeline with click events
   - Transcript only = timeline with speech events
   - Both inputs = merged sorted timeline
   - Overlapping timestamps handled correctly
   - Screenshots referenced in click events
4. `node tests/unit/test-correlator.js` exits 0 on pass
5. Uses Node.js assert module only (no external frameworks)
