# Demo-Ready Validation Script

## Goal
Create `scripts/validate-demo-ready.sh` -- the final preflight check before demo day that validates all BoothApp components are operational.

## Success Criteria
1. Script exists at `scripts/validate-demo-ready.sh` and is executable
2. Validates S3 bucket accessible with correct structure (sessions/ prefix)
3. Validates Lambda function exists and is invocable
4. Validates watcher is running and responding on health endpoint
5. Validates Chrome extension files (manifest.json parseable, required permissions)
6. Validates audio recorder script exists
7. Validates at least 1 sample session with complete analysis
8. Validates presenter pages load (curl each, check 200)
9. Validates all required environment variables are set
10. Output: large colored PASS/FAIL for each check
11. Exit 0 only if all checks pass
