# Session Comparison AI Feature

## Goal
Create a session comparison module that uses Claude (via Bedrock) to compare two booth sessions: similar interests, different products shown, engagement levels, and a combined follow-up strategy. Output to `output/comparison-<id1>-<id2>.json`.

## Success Criteria
1. `analysis/lib/session-compare.js` module exports `compareSessions(session1, session2, opts)` that calls Bedrock Claude
2. Output JSON written to `output/comparison-<id1>-<id2>.json` with fields: similarInterests, differentProducts, engagementComparison, combinedFollowUp
3. Unit tests in `analysis/test/session-compare.test.js` pass (mock Bedrock calls)
4. Presenter gets `POST /api/sessions/compare` endpoint
5. Sessions page gets UI for selecting 2 sessions and triggering comparison
6. All existing tests still pass

## Approach
- Build the comparison module in `analysis/lib/session-compare.js` using same Bedrock pattern as pipeline.js
- Add API endpoint in presenter/server.js
- Add selection UI to sessions.html
- Add comprehensive tests with mocked Bedrock responses
