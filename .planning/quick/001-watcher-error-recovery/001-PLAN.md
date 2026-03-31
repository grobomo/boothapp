# Watcher Error Recovery

## Goal
Add error recovery to the session watcher (analysis/watcher.js). When Bedrock returns ThrottlingException or ServiceUnavailableException, implement exponential backoff retry (3 attempts, 5s/15s/45s delays). Log each retry attempt. After 3 failures, move session to a 'failed' queue and continue processing other sessions.

## Success Criteria
1. watcher.js polls S3 for sessions with `ready` trigger files
2. Pipeline runs 3-stage analysis (transcribe -> correlate -> analyze via Bedrock)
3. ThrottlingException and ServiceUnavailableException trigger exponential backoff retry
4. Retry delays: 5s, 15s, 45s (3 attempts max)
5. Each retry attempt is logged with attempt number and delay
6. After 3 failures, session moves to 'failed' queue (error.json written)
7. Watcher continues processing other sessions after a failure
8. Existing tests pass; new tests cover retry logic
