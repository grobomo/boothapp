# Teams Issue Logger

## Goal
Allow users to log GitHub issues to altarr/boothapp directly from Microsoft Teams,
so booth staff can report problems without leaving their chat workflow.

## Approach
Build a lightweight webhook handler that:
1. Receives POST requests from a Teams outgoing webhook
2. Validates the HMAC signature from Teams
3. Extracts issue title/body from the message
4. Creates a GitHub issue via the GitHub API
5. Replies to Teams with a confirmation link

Deploy as an AWS Lambda behind API Gateway (matches existing infra pattern in infra/).

## Success Criteria
- [ ] Lambda function handles Teams webhook POST and creates GitHub issues
- [ ] HMAC signature validation prevents unauthorized submissions
- [ ] GitHub token and Teams secret stored as environment variables (not hardcoded)
- [ ] Response includes link to created issue
- [ ] Setup guide documents Teams webhook configuration
- [ ] Tests cover message parsing, signature validation, and issue creation
