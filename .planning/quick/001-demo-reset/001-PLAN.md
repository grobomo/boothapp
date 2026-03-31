# Demo Reset Script

## Goal
Create `scripts/demo-reset.sh` that cleans up all DEMO-* sessions from S3 and resets local watcher state, providing a clean slate before hackathon demos.

## Success Criteria
1. Script deletes all `sessions/DEMO-*` prefixes from S3 bucket
2. Script resets local watcher state (clears local sessions dir of DEMO-* entries)
3. Interactive confirmation prompt by default
4. `--force` flag skips confirmation
5. Uses same env var conventions as preflight.sh (AWS_PROFILE, BOOTH_S3_BUCKET)
6. Clear output showing what was deleted
