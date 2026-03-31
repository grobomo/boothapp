const crypto = require('crypto');
const https = require('https');

/**
 * Validate the HMAC-SHA256 signature from a Teams outgoing webhook.
 * Teams sends the signature in the Authorization header as "HMAC <base64>".
 */
function validateSignature(body, authHeader, secret) {
    if (!authHeader || !authHeader.startsWith('HMAC ')) return false;
    const providedHmac = authHeader.slice(5); // strip "HMAC " prefix
    const bufSecret = Buffer.from(secret, 'base64');
    const computed = crypto.createHmac('sha256', bufSecret).update(body).digest('base64');
    const bufComputed = Buffer.from(computed);
    const bufProvided = Buffer.from(providedHmac);
    if (bufComputed.length !== bufProvided.length) return false;
    return crypto.timingSafeEqual(bufComputed, bufProvided);
}

/**
 * Create a GitHub issue from a Teams message.
 * Returns a promise that resolves with the issue URL.
 */
function createGitHubIssue(token, repo, title, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            title,
            body,
            labels: ['from-teams'],
        });

        const options = {
            hostname: 'api.github.com',
            path: `/repos/${repo}/issues`,
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'User-Agent': 'boothapp-teams-webhook',
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 201) {
                    const parsed = JSON.parse(data);
                    resolve(parsed.html_url);
                } else {
                    reject(new Error(`GitHub API returned ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

/**
 * Express middleware for the Teams webhook endpoint.
 * Mount at POST /api/teams/webhook
 */
function teamsWebhookHandler(req, res) {
    const secret = process.env.TEAMS_WEBHOOK_SECRET;
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO || 'altarr/boothapp';

    if (!secret || !token) {
        console.error('Teams webhook: TEAMS_WEBHOOK_SECRET or GITHUB_TOKEN not set');
        return res.status(500).json({ error: 'Server misconfigured: missing env vars' });
    }

    // Teams sends JSON body; express.json() must be applied before this handler
    const rawBody = req.rawBody;
    if (!rawBody) {
        return res.status(400).json({ error: 'Missing request body' });
    }

    const authHeader = req.headers['authorization'];
    if (!validateSignature(rawBody, authHeader, secret)) {
        return res.status(401).json({ error: 'Invalid signature' });
    }

    const message = req.body;
    const senderName = (message.from && message.from.name) || 'Unknown';
    const text = message.text || '(empty message)';

    // Strip the bot mention prefix if present (e.g., "<at>BotName</at> actual message")
    const cleanText = text.replace(/<at>.*?<\/at>\s*/g, '').trim() || text;

    const issueTitle = `[Teams] ${cleanText.slice(0, 80)}`;
    const issueBody = [
        `**From:** ${senderName}`,
        `**Channel message:**`,
        '',
        cleanText,
        '',
        '---',
        '_Created automatically from a Microsoft Teams message._',
    ].join('\n');

    createGitHubIssue(token, repo, issueTitle, issueBody)
        .then((issueUrl) => {
            // Teams expects a JSON response with "type" and "text" to post a reply
            res.json({
                type: 'message',
                text: `Issue created: ${issueUrl}`,
            });
        })
        .catch((err) => {
            console.error('Teams webhook: failed to create issue:', err.message);
            res.status(500).json({
                type: 'message',
                text: 'Failed to create GitHub issue. Check server logs.',
            });
        });
}

module.exports = { teamsWebhookHandler, validateSignature, createGitHubIssue };
