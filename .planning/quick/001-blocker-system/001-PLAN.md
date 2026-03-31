# Blocker System

## Goal
Create a worker blocker reporting system that detects when workers hit blockers, documents them, creates GitHub issues, notifies the parent manager, and supports auto-resolution and escalation.

## Success Criteria
1. `scripts/fleet/blocker-system.sh` - Shell script for workers to report blockers (creates JSON doc, GitHub issue, POSTs to manager)
2. `scripts/fleet/blocker-handler.py` - Python handler running on manager that receives blockers, logs them, attempts auto-resolution, escalates if still blocked
3. `.claude/hooks/run-modules/PreToolUse/blocker-gate.js` - Hook that forces blocker creation after 3 consecutive failures on same task
4. `scripts/test/test-blocker-flow.sh` - Integration test simulating full blocker flow
5. All tests pass
