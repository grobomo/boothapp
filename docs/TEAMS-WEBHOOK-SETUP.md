# Teams-to-GitHub Webhook Setup Guide

This guide walks you through connecting a Microsoft Teams channel to GitHub Issues
so that messages posted in the channel automatically become issues with the
`from-teams` label.

## How It Works

```
Teams Channel  -->  Outgoing Webhook  -->  presenter server  -->  GitHub Issues API
   (message)        (HMAC-signed POST)      /api/teams/webhook     (creates issue)
```

1. Someone @mentions the webhook bot name in a Teams message
2. Teams sends an HMAC-signed HTTP POST to your presenter server
3. The server verifies the signature, strips the @mention, extracts the message
4. It creates a GitHub issue with the `from-teams` label
5. Teams shows a reply confirming the issue was created

## Prerequisites

- The **presenter server** (`presenter/server.js`) running and reachable from the internet via HTTPS
- A **GitHub Personal Access Token** with `repo` scope
- **Microsoft Teams** admin or owner access to the channel

## Step 1: Create a GitHub Personal Access Token

1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Name it something like `boothapp-teams-webhook`
4. Check the **repo** scope (needed to create issues)
5. Click **Generate token**
6. **Copy the token** immediately -- GitHub only shows it once

## Step 2: Set Environment Variables

On the machine running the presenter server, add these to your `.env` file
(or set them as environment variables):

```bash
# Copy from .env.example if you haven't already
cp .env.example .env
```

Edit `.env` and fill in:

```bash
# The HMAC secret -- you'll get this in Step 4 when creating the Teams webhook
TEAMS_WEBHOOK_SECRET=<paste-from-step-4>

# Your GitHub PAT from Step 1
GITHUB_TOKEN=ghp_yourTokenHere

# The repo where issues will be created
GITHUB_REPO=altarr/boothapp
```

## Step 3: Verify Your Setup

Run the setup checker to validate everything before configuring Teams:

```bash
bash scripts/verify-teams-webhook.sh
```

This checks:
- Environment variables are set
- GitHub token is valid and can access the repo
- The `from-teams` label exists (creates it if not)
- The presenter server is reachable

## Step 4: Create the Outgoing Webhook in Teams

1. Open **Microsoft Teams**
2. Go to the **channel** where you want the integration
3. Click the **...** (three dots) next to the channel name
4. Select **Manage channel**
5. Scroll down to **Connectors** or **Apps** section and find **Outgoing Webhook**
   - In new Teams: **Settings** tab > **Outgoing webhook** > **Create**
   - In classic Teams: **Connectors** > search "Outgoing Webhook" > **Configure**
6. Click **Create** and fill in:

| Field | Value |
|-------|-------|
| **Name** | `GitHub Issues` (this is what users @mention) |
| **Callback URL** | `https://<your-presenter-host>/api/teams/webhook` |
| **Description** | Posts messages as GitHub issues |

7. Click **Create**
8. **Teams shows an HMAC security token** -- this is your `TEAMS_WEBHOOK_SECRET`
9. Copy it and paste it into your `.env` file as `TEAMS_WEBHOOK_SECRET`
10. Restart the presenter server so it picks up the new secret

```bash
# Restart the server
npm run start:presenter
```

## Step 5: Test It

In your Teams channel, type:

```
@GitHub Issues This is a test issue from Teams
```

You should see:
- A reply in Teams: `Issue #123 created: https://github.com/altarr/boothapp/issues/123`
- A new issue in GitHub with the `from-teams` label

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Teams says "Unable to reach app" | Server not reachable | Check that the URL is correct, HTTPS is working, and firewall allows inbound traffic |
| "Invalid signature" in server logs | Secret mismatch | Re-copy `TEAMS_WEBHOOK_SECRET` from Teams webhook config into `.env` |
| No reply in Teams | Server crashed | Check `node` process is running; look at server logs for errors |
| "GitHub integration not configured" | Missing `GITHUB_TOKEN` | Set `GITHUB_TOKEN` in `.env` and restart |
| Issue created but no label | Label doesn't exist | Run `bash scripts/verify-teams-webhook.sh` to create it |
| 401 from GitHub API | Token expired or wrong | Generate a new token (Step 1) and update `.env` |

## HTTPS Requirement

Teams requires HTTPS for outgoing webhooks. If your presenter server runs on
plain HTTP, put a reverse proxy in front:

- **nginx** or **caddy** with Let's Encrypt auto-SSL
- **AWS ALB/CloudFront** if running on EC2
- **ngrok** for local testing: `ngrok http 3000` gives a temporary HTTPS URL

## Security Notes

- The HMAC signature verification prevents anyone from sending fake webhook
  payloads to your endpoint
- Keep `TEAMS_WEBHOOK_SECRET` and `GITHUB_TOKEN` in `.env` (which is gitignored),
  never commit them
- The GitHub token only needs `repo` scope -- don't grant broader permissions
