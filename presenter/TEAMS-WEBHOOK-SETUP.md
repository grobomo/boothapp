# Teams Webhook Setup Guide

This guide walks through connecting a Microsoft Teams channel to BoothApp so that
messages posted in the channel automatically create GitHub issues with the `from-teams` label.

## How It Works

```
Teams Channel --> Outgoing Webhook --> Presenter Server --> GitHub Issues API
                  (POST to your URL)   /api/teams/webhook    (creates issue)
```

1. Someone posts a message in your Teams channel
2. Teams sends the message to your presenter server
3. The server validates the HMAC signature, then creates a GitHub issue
4. A confirmation reply appears in the Teams channel with the issue link

## Step 1: Set Environment Variables on the Presenter Server

You need two env vars on the machine running the presenter server. Set them before
starting the server (or add them to your deployment config).

```bash
# The HMAC secret Teams gives you (you'll get this in Step 2)
export TEAMS_WEBHOOK_SECRET="<base64-secret-from-teams>"

# A GitHub personal access token with "repo" scope
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"

# (Optional) Override the target repo. Defaults to altarr/boothapp
export GITHUB_REPO="altarr/boothapp"
```

### Creating a GitHub Token

1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Give it a name like "boothapp-teams-webhook"
4. Select the **repo** scope (full control of private repositories)
5. Click **Generate token** and copy the value into `GITHUB_TOKEN`

## Step 2: Create the Outgoing Webhook in Teams

1. Open Microsoft Teams and go to the channel you want to connect
2. Click the **...** (more options) next to the channel name
3. Select **Connectors** (or **Manage channel** > **Connectors** depending on your Teams version)
4. Search for **Outgoing Webhook** and click **Configure**
5. Fill in the form:
   - **Name**: `BoothApp` (this is what users @mention to trigger the webhook)
   - **Callback URL**: `https://<your-presenter-host>/api/teams/webhook`
     - Replace `<your-presenter-host>` with your actual server hostname/IP
     - Must be HTTPS in production (Teams requires it)
   - **Description**: Creates GitHub issues from Teams messages
6. Click **Create**
7. Teams shows you a **Security token** (base64 string) -- copy this value
8. Set it as `TEAMS_WEBHOOK_SECRET` on your presenter server (Step 1)

## Step 3: Test It

1. Start the presenter server:
   ```bash
   cd presenter
   npm start
   ```
2. In the Teams channel, type: `@BoothApp test issue from Teams`
3. Check that:
   - A reply appears in Teams with the GitHub issue URL
   - The issue exists on GitHub with the `from-teams` label

## Troubleshooting

| Problem | Fix |
|---------|-----|
| 401 Unauthorized | The `TEAMS_WEBHOOK_SECRET` doesn't match. Re-copy the security token from Teams webhook config. |
| 500 Server Error | Check that `GITHUB_TOKEN` is set and has `repo` scope. Check server logs. |
| No response in Teams | Verify the callback URL is reachable from the internet. Teams can't reach localhost. |
| Issues created in wrong repo | Set `GITHUB_REPO=owner/repo` env var to override the default. |

## Notes

- The webhook only fires when someone @mentions the bot name (e.g., `@BoothApp`)
- The bot mention prefix is automatically stripped from the issue title
- Messages are attributed to the Teams sender's display name
