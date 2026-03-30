# Integration Test Script

## Goal
Create scripts/test-integration.sh that exercises the full watcher/analysis pipeline end-to-end using real S3 operations.

## Success Criteria
1. Creates a test session in S3 with unique ID (TEST-INT- prefix)
2. Uploads sample metadata.json (status: ended), clicks.json, transcript.json
3. Verifies watcher detects and claims the session (output/.analysis-claimed marker)
4. Waits up to 120s for analysis output in S3
5. Verifies output/summary.json exists and has expected fields (session_id, visitor_name, executive_summary, products_shown, recommended_follow_up)
6. Cleans up test session from S3 on exit
7. Uses --profile hackathon for all AWS commands
8. Returns exit 0 on success, exit 1 on failure with clear diagnostics
