# Notification System

## Goal
Add `infra/notifications/notify.js` that sends notifications when session analysis completes (summary.json written to S3). Two channels: browser push via SSE to the presenter dashboard, and webhook POST to configurable URLs.

## Success Criteria
1. `infra/notifications/notify.js` exports `notifySessionComplete(sessionSummary)`
2. SSE endpoint at `/api/notifications/stream` on presenter server sends events to connected browsers
3. Webhook POST sends JSON payload to each URL in `infra/notifications/notify-config.json`
4. Config file supports multiple webhook URLs with labels
5. Webhook failures are logged but don't block other notifications
6. Integration point: watcher calls notify after writing summary to S3
7. Tests pass for notify module
