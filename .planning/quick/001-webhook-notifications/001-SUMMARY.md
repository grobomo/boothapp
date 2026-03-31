# Webhook Notification System -- Summary

## What Was Done
- Created `infra/webhooks.js` with `notifyWebhooks(sessionData)` entry point
- Slack formatter: Block Kit message with visitor name, company, score, products, interests
- Teams formatter: Adaptive Card v1.4 with ColumnSet layout and FactSet
- Generic formatter: JSON payload with event type, timestamp, session data
- Retry: 3 attempts with exponential backoff (1s, 2s, 4s), configurable via env
- Logging: all deliveries logged with timestamp, target, status, attempt count
- Default: no-op when no webhook URLs configured
- Created `tests/test_webhooks.js` with 43 tests (all passing)

## Configuration
Environment variables:
- `WEBHOOK_SLACK_URL` - Slack incoming webhook URL
- `WEBHOOK_TEAMS_URL` - Teams incoming webhook URL
- `WEBHOOK_GENERIC_URL` - Generic HTTP POST endpoint
- `WEBHOOK_MAX_RETRIES` - Override retry count (default: 3)
- `WEBHOOK_TIMEOUT_MS` - Override request timeout (default: 10000ms)

## Integration Point
Call `notifyWebhooks(sessionData)` after analysis pipeline completes (e.g., in watcher.js after writing result.json).
