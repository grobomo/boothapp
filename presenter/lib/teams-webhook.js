'use strict';

// Teams-to-GitHub-Issues Webhook
//
// POST /api/teams/webhook — receive Teams outgoing webhook, create GitHub issue
//
// Setup:
//   1. Create an outgoing webhook in your Teams channel pointing to
//      https://<presenter-host>/api/teams/webhook
//   2. Set env vars:
//      TEAMS_WEBHOOK_SECRET  — the HMAC secret from Teams webhook config
//      GITHUB_TOKEN          — a GitHub PAT with repo scope
//      GITHUB_REPO           — owner/repo (default: altarr/boothapp)
//   3. Messages in the channel become GitHub issues with the "from-teams" label

const { Router } = require('express');
const crypto = require('crypto');
const https = require('https');

function verifyTeamsSignature(secret, rawBody, authHeader) {
  if (!secret || !authHeader) return false;
  // Teams sends: HMAC <base64-hash>
  const provided = authHeader.replace(/^HMAC\s+/i, '');
  const expected = crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(rawBody)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, 'base64'),
      Buffer.from(expected, 'base64')
    );
  } catch {
    return false;
  }
}

function githubRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'boothapp-teams-webhook',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(text) });
        } catch {
          resolve({ status: res.statusCode, data: text });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function createRouter() {
  const router = Router();
  const secret = process.env.TEAMS_WEBHOOK_SECRET || '';
  const token = process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPO || 'altarr/boothapp';

  // Capture raw body for HMAC verification
  router.use('/api/teams/webhook', (req, res, next) => {
    if (req._rawBody) return next();
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      req._rawBody = Buffer.concat(chunks).toString('utf-8');
      try {
        req.body = JSON.parse(req._rawBody);
      } catch {
        req.body = {};
      }
      next();
    });
  });

  router.post('/api/teams/webhook', async (req, res) => {
    // Verify HMAC signature if secret is configured
    if (secret) {
      const authHeader = req.headers['authorization'] || '';
      if (!verifyTeamsSignature(secret, req._rawBody, authHeader)) {
        return res.status(401).json({ type: 'message', text: 'Invalid signature' });
      }
    }

    // Extract message text from Teams payload
    const text = (req.body && req.body.text) || '';
    const from = (req.body && req.body.from && req.body.from.name) || 'Unknown';

    // Strip the bot mention (Teams prepends <at>BotName</at>)
    const cleaned = text.replace(/<at>.*?<\/at>\s*/gi, '').trim();

    if (!cleaned) {
      return res.status(200).json({
        type: 'message',
        text: 'Empty message. Send a message to create a GitHub issue.'
      });
    }

    if (!token) {
      console.error('[teams-webhook] GITHUB_TOKEN not configured');
      return res.status(200).json({
        type: 'message',
        text: 'GitHub integration not configured (missing GITHUB_TOKEN).'
      });
    }

    // Parse title and body: first line = title, rest = body
    const lines = cleaned.split('\n');
    const title = lines[0].slice(0, 256);
    const body = [
      lines.slice(1).join('\n').trim(),
      '',
      `---`,
      `Created from Teams by ${from}`
    ].join('\n');

    try {
      const result = await githubRequest('POST', `/repos/${repo}/issues`, token, {
        title,
        body,
        labels: ['from-teams']
      });

      if (result.status === 201) {
        const issue = result.data;
        return res.status(200).json({
          type: 'message',
          text: `Issue #${issue.number} created: ${issue.html_url}`
        });
      }

      console.error(`[teams-webhook] GitHub API error: ${result.status}`, result.data);
      return res.status(200).json({
        type: 'message',
        text: `Failed to create issue (GitHub API returned ${result.status}).`
      });
    } catch (err) {
      console.error('[teams-webhook] Error creating issue:', err.message);
      return res.status(200).json({
        type: 'message',
        text: 'Internal error creating GitHub issue.'
      });
    }
  });

  return router;
}

module.exports = { createRouter };
