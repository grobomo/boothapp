# Teams-to-GitHub-Issues Webhook

## Goal
Add a `POST /api/teams/webhook` endpoint to the presenter server so team members can create GitHub issues directly from Microsoft Teams via an outgoing webhook.

## Success Criteria
- [ ] POST /api/teams/webhook endpoint exists and accepts Teams outgoing webhook payloads
- [ ] HMAC-SHA256 signature verification using TEAMS_WEBHOOK_SECRET env var
- [ ] Creates GitHub issues via GitHub API using GITHUB_TOKEN env var
- [ ] Issues created with `from-teams` label
- [ ] Returns Teams-compatible response (adaptive card or text)
- [ ] Handles missing/invalid payloads gracefully with appropriate HTTP status codes
- [ ] Rate limited to prevent abuse
- [ ] Documented setup in README or code comments
