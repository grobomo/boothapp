# Test Orchestrator E2E

## Goal
Create `infra/session-orchestrator/test-orchestrator.js` that tests Lambda end-to-end against real S3.

## Success Criteria
1. createSession called, verify S3 `sessions/<id>/metadata.json` exists
2. Verify `commands/<demo_pc>/start.json` written
3. endSession called, verify `commands/<demo_pc>/end.json` written
4. Verify `status=ended` in metadata after end
5. AWS SDK v3 used for S3 verification
6. Exit 0 on pass, non-zero on fail
7. Branch created, committed, pushed, PR to main
