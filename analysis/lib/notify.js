// Notification module — sends completion notifications after analysis pipeline
//
// Writes notification.json to S3, logs completion, and POSTs to webhook(s).
// Supports multiple webhooks via comma-separated WEBHOOK_URL env var.
// Retries failed webhooks 3 times with exponential backoff.

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const {
  S3Client,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { SSE_PARAMS } = require('../../infra/lib/s3-encryption');
const { withRetry } = require('./retry');

const REGION = process.env.AWS_REGION || 'us-east-1';
const WEBHOOK_MAX_RETRIES = 3;
const WEBHOOK_BASE_DELAY_MS = 1000;

function log(sessionId, msg) {
  console.log(`[notify:${sessionId}] ${new Date().toISOString()} ${msg}`);
}

// Parse WEBHOOK_URL env var into an array of trimmed, non-empty URLs.
function parseWebhookUrls(envValue) {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map(function(u) { return u.trim(); })
    .filter(function(u) { return u.length > 0; });
}

// Build the webhook payload from pipeline outputs.
// Includes all fields required for Slack/Teams/CRM integrations.
function buildWebhookPayload({ sessionId, bucket, metadata, summary, followUp }) {
  const priority = followUp.priority || 'medium';
  const engagementScore = summary.session_score || null;

  return {
    session_id: sessionId,
    visitor_name: summary.visitor_name || metadata.visitor_name || 'Unknown',
    company: metadata.company || summary.company || null,
    products_demonstrated: summary.products_demonstrated || [],
    key_interests: (summary.key_interests || []).map(function(ki) {
      return typeof ki === 'string' ? ki : ki.topic;
    }),
    engagement_score: engagementScore,
    follow_up_priority: priority,
    analysis_url: `https://boothapp.trendmicro.com/sessions/${sessionId}/summary.html`,
  };
}

// Build the notification payload (superset — written to S3 notification.json).
function buildNotification({ sessionId, bucket, metadata, summary, followUp }) {
  const score = followUp.priority === 'high' ? 'high'
    : followUp.priority === 'medium' ? 'medium'
    : 'low';

  return {
    session_id: sessionId,
    visitor_name: summary.visitor_name || metadata.visitor_name || 'Unknown',
    company: metadata.company || summary.company || null,
    session_score: summary.session_score || null,
    score: score,
    executive_summary: followUp.sdr_notes || null,
    products_demonstrated: summary.products_demonstrated || [],
    completed_at: new Date().toISOString(),
    report_url: `https://boothapp.trendmicro.com/sessions/${sessionId}/summary.html`,
  };
}

// Write notification.json to the session's S3 output folder
async function writeNotificationToS3(bucket, sessionId, notification) {
  const client = new S3Client({ region: REGION });
  const key = `sessions/${sessionId}/output/notification.json`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(notification, null, 2),
    ContentType: 'application/json',
    ...SSE_PARAMS,
  }));
  log(sessionId, `Wrote s3://${bucket}/${key}`);
}

// POST JSON payload to a single webhook URL.
function postWebhook(url, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);

    const req = transport.request(parsed, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: data });
        } else {
          reject(new Error(`Webhook returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Webhook request timed out (10s)'));
    });
    req.write(body);
    req.end();
  });
}

// Deliver webhook payload to a single URL with retry + exponential backoff.
// Returns a delivery status object for logging.
async function deliverWebhook(sessionId, url, payload) {
  const status = {
    url: url,
    attempts: 0,
    success: false,
    error: null,
    delivered_at: null,
  };

  try {
    await withRetry(`webhook ${url}`, () => {
      status.attempts++;
      return postWebhook(url, payload);
    }, {
      maxRetries: WEBHOOK_MAX_RETRIES,
      baseDelayMs: WEBHOOK_BASE_DELAY_MS,
      onRetry: (err, attempt, delay) => {
        log(sessionId, `Webhook ${url}: attempt ${attempt}/${WEBHOOK_MAX_RETRIES} failed (${err.message}), retrying in ${delay}ms...`);
      },
    });
    status.success = true;
    status.delivered_at = new Date().toISOString();
    log(sessionId, `Webhook delivered: ${url} (${status.attempts} attempt(s))`);
  } catch (err) {
    status.error = err.message;
    log(sessionId, `Webhook FAILED after ${status.attempts} attempts: ${url} -- ${err.message}`);
  }

  return status;
}

// Deliver webhook payload to all configured URLs.
// Returns array of delivery status objects.
async function deliverWebhooks(sessionId, payload) {
  const urls = parseWebhookUrls(process.env.WEBHOOK_URL);
  if (urls.length === 0) return [];

  log(sessionId, `Delivering webhooks to ${urls.length} endpoint(s)`);
  const results = [];
  for (const url of urls) {
    const status = await deliverWebhook(sessionId, url, payload);
    results.push(status);
  }

  const succeeded = results.filter(function(r) { return r.success; }).length;
  const failed = results.length - succeeded;
  log(sessionId, `Webhook delivery complete: ${succeeded} succeeded, ${failed} failed`);

  return results;
}

// Main notification entry point.
// Options:
//   dryRun: if true, skip S3 write and webhook delivery — just log
async function sendNotification({ sessionId, bucket, metadata, summary, followUp, dryRun }) {
  const notification = buildNotification({ sessionId, bucket, metadata, summary, followUp });

  // Always log the completion message
  console.log('');
  console.log('========================================');
  console.log(`  ANALYSIS COMPLETE: ${sessionId}`);
  console.log(`  Visitor: ${notification.visitor_name}`);
  console.log(`  Score:   ${notification.score}`);
  console.log('========================================');
  console.log('');

  // Write to S3 (unless dry run)
  if (!dryRun) {
    await writeNotificationToS3(bucket, sessionId, notification);
  } else {
    log(sessionId, 'DRY RUN — skipping S3 write');
    log(sessionId, `Notification payload: ${JSON.stringify(notification, null, 2)}`);
  }

  // Deliver webhooks (with retry) if configured
  const webhookPayload = buildWebhookPayload({ sessionId, bucket, metadata, summary, followUp });
  let webhookResults = [];
  if (!dryRun) {
    webhookResults = await deliverWebhooks(sessionId, webhookPayload);
  } else {
    const urls = parseWebhookUrls(process.env.WEBHOOK_URL);
    if (urls.length > 0) {
      log(sessionId, `DRY RUN — would deliver to ${urls.length} webhook(s): ${urls.join(', ')}`);
      log(sessionId, `Webhook payload: ${JSON.stringify(webhookPayload, null, 2)}`);
    }
  }

  notification.webhook_results = webhookResults;
  return notification;
}

module.exports = {
  sendNotification,
  buildNotification,
  buildWebhookPayload,
  postWebhook,
  deliverWebhook,
  deliverWebhooks,
  parseWebhookUrls,
};
