# Integration Test: Analysis Pipeline

## Goal
Create a Node.js integration test at tests/integration/test-analysis-pipeline.js that validates the full analysis pipeline end-to-end against real S3.

## Success Criteria
1. Creates mock session folder in S3 with metadata.json, clicks.json, transcript.json
2. Triggers analysis pipeline via runPipeline() with mock Bedrock client
3. Verifies output/summary.json exists with required fields (visitor_name, products, recommendations)
4. Verifies output/summary.html exists and is valid HTML
5. Verifies output/scores.json exists if scorer is integrated
6. Cleans up test session from S3
7. Uses Node.js assert module
8. Exits 0 on pass, non-zero on fail
9. Requires S3_BUCKET and AWS_REGION env vars
