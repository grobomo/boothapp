# Summary: Demo-Ready Validation Script

## What was done
Created `scripts/validate-demo-ready.sh` -- an 8-point preflight check for demo day.

## Checks implemented
1. Environment variables (AWS_PROFILE, AWS_REGION, BOOTH_S3_BUCKET)
2. S3 bucket accessible with sessions/ prefix
3. Lambda function exists and invocable
4. Watcher health endpoint returns 200
5. Chrome extension manifest.json parseable with required permissions
6. Audio recorder script exists in extension/
7. At least 1 sample session with complete analysis (output/result.json)
8. Presenter pages return HTTP 200

## Output
- Large ASCII PASS/FAIL banner
- Color-coded per-check results
- Exit 0 only if all 8 pass
