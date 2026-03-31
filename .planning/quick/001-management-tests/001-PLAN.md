# Management Server Tests

## Goal
Add automated API test suite for the CaseyApp management server (merged via PR #375).

## Success Criteria
1. Test script covers all API endpoints: health, auth, events, demo-pcs, sessions, contacts, users
2. Tests run without S3 access (graceful skip for S3-dependent endpoints)
3. `npm test` in management/ directory runs the suite
4. All tests pass against the running server
5. Tests validate auth guards (401 without session cookie)
