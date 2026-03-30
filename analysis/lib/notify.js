// Notification module — sends completion notifications after analysis pipeline
//
// Writes notification.json to S3, logs completion, and optionally POSTs to a webhook.

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const {
  S3Client,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');

const REGION = process.env.AWS_REGION || 'us-east-1';

function log(sessionId, msg) {
  console.log(`[notify:${sessionId}] ${new Date().toISOString()} ${msg}`);
}

// Build the notification payload from pipeline outputs.
// summary = parsed summary.json, followUp = parsed follow-up.json, metadata = parsed metadata.json
function buildNotification({ sessionId, bucket, metadata, summary, followUp }) {
  const score = followUp.priority === 'high' ? 'high'
    : followUp.priority === 'medium' ? 'medium'
    : 'low';

  return {
    session_id: sessionId,
    visitor_name: summary.visitor_name || metadata.visitor_name || 'Unknown',
    company: metadata.company || summary.company || null,
    score: score,
    executive_summary: followUp.sdr_notes || null,
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
  }));
  log(sessionId, `Wrote s3://${bucket}/${key}`);
}

// POST notification JSON to a webhook URL (Slack, Teams, etc.)
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

// Main notification entry point.
// Options:
//   dryRun: if true, skip S3 write and just log/webhook
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

  // POST to webhook if configured
  const webhookUrl = process.env.WEBHOOK_URL;
  if (webhookUrl) {
    try {
      log(sessionId, `POSTing to webhook: ${webhookUrl}`);
      await postWebhook(webhookUrl, notification);
      log(sessionId, 'Webhook POST succeeded');
    } catch (err) {
      log(sessionId, `WARNING: Webhook POST failed — ${err.message}`);
    }
  }

  return notification;
}

module.exports = { sendNotification, buildNotification, postWebhook };
