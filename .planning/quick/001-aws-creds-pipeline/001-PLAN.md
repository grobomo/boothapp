# Fix AWS Credential Injection in Analysis Pipeline

## Goal
Ensure the Python `analyze.py` subprocess (and other Python subprocesses) spawned from the Node.js pipeline receive AWS credentials and config env vars.

## Problem
- `pipeline-run.js` uses `execFileSync('python3', ...)` without passing `env` option
- Node's `execFileSync` defaults to inheriting `process.env`, BUT only when `env` is not specified. The issue is that `stdio: 'inherit'` is set but `env` is not explicitly passed, which should inherit by default.
- However, the real fix requested: explicitly pass all 6 env vars (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION, USE_BEDROCK, ANALYSIS_MODEL)
- `analyze.py` reads session data from S3 via boto3 but lacks credential fallback (AWS_PROFILE, instance metadata)

## Success Criteria
- [ ] pipeline-run.js explicitly passes AWS creds + config env vars to all Python/Node child processes
- [ ] analyze.py boto3 client has fallback credential chain (env vars -> AWS_PROFILE -> instance metadata)
- [ ] No regression in existing pipeline behavior
- [ ] Tests pass
