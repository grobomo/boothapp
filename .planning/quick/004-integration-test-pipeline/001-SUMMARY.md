# Summary: Integration Test for Analysis Pipeline

## What was done
Created `tests/integration/test-analysis-pipeline.js` -- a Node.js integration test that validates the full analysis pipeline against real S3.

## Test flow
1. Uploads mock session data to S3 (metadata.json, clicks.json, transcript.json, audio.webm)
2. Runs `runPipeline()` with real S3 client + mock Bedrock client (returns realistic analysis)
3. Writes output artifacts (summary.json, summary.html) to S3
4. Verifies summary.json has required fields: visitor_name, products, recommendations
5. Verifies summary.html exists and contains valid HTML with visitor name
6. Checks for optional scores.json (skips if scorer not integrated)
7. Cleans up all test objects from S3 (both sessions/ and recordings/ prefixes)

## Design decisions
- Mock Bedrock client to avoid real AI calls while still testing full data flow
- Real S3 integration to validate upload/download/cleanup
- Unique session ID per run (timestamp + PID) to avoid collisions
- Cleanup in finally block to prevent test data accumulation
- Follows same assertion style as existing tests (Node.js assert)

## Verification
- Syntax check passes (`node -c`)
- Fails gracefully with clear error when S3_BUCKET/AWS_REGION not set
- Cannot run full test in this environment (no AWS credentials)
