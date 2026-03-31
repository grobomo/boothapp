const express = require('express');
const path = require('path');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;
const BUCKET = process.env.S3_BUCKET || 'boothapp-sessions';
const REGION = process.env.AWS_REGION || 'us-east-1';

const s3 = new S3Client({ region: REGION });

// Serve static HTML files
app.use(express.static(path.join(__dirname)));

// GET /api/sessions - list all sessions with metadata and analysis status
app.get('/api/sessions', async (req, res) => {
    try {
        // List all top-level "directories" (session prefixes) in the bucket
        const listCmd = new ListObjectsV2Command({
            Bucket: BUCKET,
            Delimiter: '/',
        });
        const listResult = await s3.send(listCmd);
        const prefixes = (listResult.CommonPrefixes || []).map(p => p.Prefix);

        // For each session prefix, fetch metadata.json and check for analysis
        const sessions = await Promise.all(prefixes.map(async (prefix) => {
            const sessionId = prefix.replace(/\/$/, '');
            const session = {
                session_id: sessionId,
                visitor_name: null,
                status: 'unknown',
                created_at: null,
                has_analysis: false,
                summary_link: null,
            };

            // Try to read metadata.json
            try {
                const metaCmd = new GetObjectCommand({
                    Bucket: BUCKET,
                    Key: `${sessionId}/metadata.json`,
                });
                const metaResult = await s3.send(metaCmd);
                const body = await metaResult.Body.transformToString();
                const meta = JSON.parse(body);
                session.visitor_name = meta.visitor_name || null;
                session.status = meta.status || 'unknown';
                session.created_at = meta.created_at || null;
            } catch {
                // metadata.json missing or unreadable - continue with defaults
            }

            // Check if analysis summary exists
            try {
                const summaryKey = `${sessionId}/summary.html`;
                const summaryCmd = new GetObjectCommand({
                    Bucket: BUCKET,
                    Key: summaryKey,
                });
                await s3.send(summaryCmd);
                session.has_analysis = true;
                session.summary_link = `/api/sessions/${sessionId}/summary`;
            } catch {
                // No summary - has_analysis stays false
            }

            return session;
        }));

        // Sort by created_at descending (newest first), nulls last
        sessions.sort((a, b) => {
            if (!a.created_at && !b.created_at) return 0;
            if (!a.created_at) return 1;
            if (!b.created_at) return -1;
            return new Date(b.created_at) - new Date(a.created_at);
        });

        res.json({ sessions });
    } catch (err) {
        console.error('Failed to list sessions:', err.message);
        res.status(500).json({ error: 'Failed to list sessions', detail: err.message });
    }
});

// GET /api/sessions/:id/summary - proxy the summary HTML from S3
app.get('/api/sessions/:id/summary', async (req, res) => {
    try {
        const cmd = new GetObjectCommand({
            Bucket: BUCKET,
            Key: `${req.params.id}/summary.html`,
        });
        const result = await s3.send(cmd);
        res.setHeader('Content-Type', 'text/html');
        result.Body.pipe(res);
    } catch (err) {
        if (err.name === 'NoSuchKey') {
            res.status(404).json({ error: 'Summary not found' });
        } else {
            res.status(500).json({ error: 'Failed to fetch summary', detail: err.message });
        }
    }
});

// GET /api/health - health check for container orchestration
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, () => {
    console.log(`Presenter server running on http://localhost:${PORT}`);
});
