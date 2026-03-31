# Dual-Verify PR Review System

## Goal
Implement junior-dev + senior-dev verification pattern that blocks PR merges until both worker tests and manager code review pass.

## Success Criteria
- [x] PreToolUse gate blocks `gh pr merge` without both markers
- [x] worker-verify.sh runs all test scripts and creates marker
- [x] manager-review.sh runs code quality checks and creates marker
- [x] Integration test validates the full flow
- [x] All tests pass
