# Teams Webhook Integration

## Goal
Implement the `/api/teams/webhook` endpoint on the presenter server so that Microsoft Teams outgoing webhook messages are received, validated, and forwarded as GitHub issues with the `from-teams` label. Add clear setup documentation addressing issue #365.

## Success Criteria
1. POST `/api/teams/webhook` endpoint exists on the presenter server
2. HMAC-SHA256 signature validation using `TEAMS_WEBHOOK_SECRET` env var
3. Creates a GitHub issue via the GitHub API using `GITHUB_TOKEN` env var
4. Issue gets the `from-teams` label automatically
5. Returns appropriate responses (200 on success, 401 on bad signature, 500 on error)
6. Setup documentation in `presenter/TEAMS-WEBHOOK-SETUP.md` with step-by-step instructions
7. Unit tests cover: valid webhook, invalid signature, missing env vars
8. No new npm dependencies beyond Node built-ins (crypto, https)
