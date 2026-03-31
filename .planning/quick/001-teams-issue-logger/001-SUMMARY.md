# Teams Issue Logger - Summary

## What was done
Built a Teams outgoing webhook handler (AWS Lambda) that lets booth staff create
GitHub issues by mentioning a bot in Teams.

## Files created
- `infra/teams-webhook/index.js` - Lambda handler: validates HMAC, parses Teams messages, creates GitHub issues
- `infra/teams-webhook/template.yaml` - SAM template for deployment
- `infra/teams-webhook/SETUP.md` - Step-by-step setup guide
- `infra/teams-webhook/test.js` - 9 tests covering parsing, HMAC validation, error handling

## How it works
1. User types `@BoothApp Scanner broken | Details here` in Teams
2. Teams sends POST to Lambda with HMAC signature
3. Lambda validates signature, extracts title/body, calls GitHub API
4. Lambda replies to Teams with link to created issue

## Tests
9/9 passing. Existing project tests unaffected.
