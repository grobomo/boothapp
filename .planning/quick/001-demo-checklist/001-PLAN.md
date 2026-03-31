# Demo Checklist Script

## Goal
Create scripts/demo-checklist.sh that verifies all BoothApp components are ready for demo day.

## Success Criteria
1. S3 bucket accessible with AWS creds
2. Lambda function exists and responds
3. Chrome extension manifest.json is valid
4. Audio recorder package.json has all deps
5. Analysis pipeline can import all modules
6. Each check prints PASS/FAIL
7. Exit 0 only if all pass
8. Branch created, committed, pushed, PR to main

## Status
COMPLETE -- PR #136 merged to main.
