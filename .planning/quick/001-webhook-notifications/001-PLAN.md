# Webhook Notification System

## Goal
Create `infra/webhooks.js` -- a webhook notification system that fires when a session analysis completes. Supports Slack, Microsoft Teams, and generic HTTP POST endpoints with retry logic and delivery logging.

## Success Criteria
1. `infra/webhooks.js` exports a `notifyWebhooks(sessionData)` function
2. Slack webhook sends formatted message with visitor name, score, products
3. Microsoft Teams webhook sends Adaptive Card format
4. Generic HTTP POST sends JSON payload
5. Webhooks configured via environment variables (WEBHOOK_SLACK_URL, WEBHOOK_TEAMS_URL, WEBHOOK_GENERIC_URL)
6. Retry 3 times with exponential backoff on failure
7. All webhook deliveries logged to stdout with timestamp, target, status
8. Default: no webhooks configured (no-op when URLs not set)
9. Tests pass covering all formatters, retry logic, and delivery logging

## Implementation
- `infra/webhooks.js` -- main module (zero external dependencies, uses Node built-in fetch)
- `tests/test_webhooks.js` -- test suite using Node built-in test runner (matching project convention)
