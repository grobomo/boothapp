# Session Validator Tests

## Goal
Create `infra/validator.js` — a session data validator that checks session objects for structural correctness — and `tests/unit/test-validator.js` with comprehensive unit tests using Node's built-in test runner.

## Success Criteria
1. `infra/validator.js` exports validation functions for session data
2. `tests/unit/test-validator.js` covers all required cases:
   - Valid session passes
   - Missing metadata fails
   - Invalid status fails
   - Empty events array fails
   - Missing timestamps fail
   - Non-chronological timestamps warn
   - Valid transcript passes
   - Empty entries fails
3. All tests pass with `node --test tests/unit/test-validator.js`
