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

// GET /api/sessions/:id/screenshots - list screenshots with click metadata
app.get('/api/sessions/:id/screenshots', async (req, res) => {
    try {
        const sessionId = req.params.id;

        // List all screenshot files in the session
        const listCmd = new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: `${sessionId}/screenshots/`,
        });
        const listResult = await s3.send(listCmd);
        const objects = (listResult.Contents || [])
            .filter(obj => /\.(jpg|jpeg|png)$/i.test(obj.Key))
            .sort((a, b) => (a.Key > b.Key ? 1 : -1));

        // Try to load clicks.json for metadata
        let clickEvents = [];
        try {
            const clicksCmd = new GetObjectCommand({
                Bucket: BUCKET,
                Key: `${sessionId}/clicks/clicks.json`,
            });
            const clicksResult = await s3.send(clicksCmd);
            const body = await clicksResult.Body.transformToString();
            const parsed = JSON.parse(body);
            clickEvents = parsed.events || [];
        } catch {
            // clicks.json missing - continue without metadata
        }

        // Build a lookup from screenshot filename to click event
        const clickByScreenshot = {};
        for (const evt of clickEvents) {
            if (evt.screenshot_file) {
                const basename = evt.screenshot_file.replace(/^screenshots\//, '');
                clickByScreenshot[basename] = evt;
            }
        }

        const screenshots = objects.map((obj, idx) => {
            const filename = obj.Key.split('/').pop();
            const evt = clickByScreenshot[filename] || {};

            // Parse click number from filename: screenshot_click{N}_{timestamp}.jpg
            const clickMatch = filename.match(/click(\d+)/);
            const clickNumber = clickMatch ? parseInt(clickMatch[1], 10) : idx + 1;

            return {
                filename,
                url: `/api/sessions/${sessionId}/screenshots/${filename}`,
                click_number: clickNumber,
                timestamp: evt.timestamp || obj.LastModified || null,
                element: evt.element || evt.selector || null,
                page_url: evt.url || null,
            };
        });

        res.json({ screenshots });
    } catch (err) {
        console.error('Failed to list screenshots:', err.message);
        res.status(500).json({ error: 'Failed to list screenshots', detail: err.message });
    }
});

// GET /api/sessions/:id/screenshots/:filename - proxy screenshot image from S3
app.get('/api/sessions/:id/screenshots/:filename', async (req, res) => {
    try {
        const cmd = new GetObjectCommand({
            Bucket: BUCKET,
            Key: `${req.params.id}/screenshots/${req.params.filename}`,
        });
        const result = await s3.send(cmd);
        res.setHeader('Content-Type', result.ContentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        result.Body.pipe(res);
    } catch (err) {
        if (err.name === 'NoSuchKey') {
            res.status(404).json({ error: 'Screenshot not found' });
        } else {
            res.status(500).json({ error: 'Failed to fetch screenshot', detail: err.message });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Presenter server running on http://localhost:${PORT}`);
});
