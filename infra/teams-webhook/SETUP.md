# Teams Issue Logger Setup

Log GitHub issues to boothapp directly from Microsoft Teams.

## How it works

1. You mention the bot in Teams: `@BoothApp Scanner broken | Badge scanner on booth 3 times out`
2. Teams sends the message to an AWS Lambda via outgoing webhook
3. Lambda creates a GitHub issue with the `from-teams` label
4. Lambda replies in Teams with a link to the new issue

## Message format

```
@BoothApp <title>
@BoothApp <title> | <description>
```

If no `|` separator is used, the entire message becomes the issue title.

## Deploy

### 1. Create a GitHub personal access token

- Go to GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens
- Select the `altarr/boothapp` repository
- Grant **Issues: Read and write** permission
- Copy the token

### 2. Deploy the Lambda

```bash
cd infra/teams-webhook
sam build
sam deploy --guided \
  --parameter-overrides \
    GitHubToken=ghp_YOUR_TOKEN \
    GitHubRepo=altarr/boothapp \
    TeamsWebhookSecret=YOUR_TEAMS_SECRET
```

Copy the `WebhookUrl` from the output.

### 3. Create a Teams outgoing webhook

1. In Teams, go to the channel where you want the bot
2. Click `...` > **Manage channel** > **Edit**
3. Under **Connectors** or **Apps**, select **Outgoing webhook**
4. Name: `BoothApp`, Callback URL: paste the Lambda URL from step 2
5. Copy the **HMAC security token** Teams gives you
6. Update the Lambda's `TEAMS_WEBHOOK_SECRET` env var with this token

### 4. Test

In the Teams channel, type:

```
@BoothApp Test issue from Teams | Just checking the integration works
```

You should get a reply with a link to the new GitHub issue.
