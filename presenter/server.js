const express = require('express');
const path = require('path');
const http = require('http');
const { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const BUCKET = process.env.S3_BUCKET || 'boothapp-sessions';
const REGION = process.env.AWS_REGION || 'us-east-1';
const WATCHER_HEALTH = process.env.WATCHER_HEALTH || 'http://localhost:8080';

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

// DELETE /api/sessions/:id - delete all objects for a session
app.delete('/api/sessions/:id', async (req, res) => {
    try {
        const prefix = `${req.params.id}/`;
        const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
        const listResult = await s3.send(listCmd);
        const objects = (listResult.Contents || []).map(o => ({ Key: o.Key }));

        if (objects.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        await s3.send(new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: objects },
        }));

        res.json({ deleted: true, objectsRemoved: objects.length });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete session', detail: err.message });
    }
});

// POST /api/sessions/:id/retry - remove output/ so watcher re-processes
app.post('/api/sessions/:id/retry', async (req, res) => {
    try {
        const prefix = `${req.params.id}/output/`;
        const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
        const listResult = await s3.send(listCmd);
        const objects = (listResult.Contents || []).map(o => ({ Key: o.Key }));

        if (objects.length > 0) {
            await s3.send(new DeleteObjectsCommand({
                Bucket: BUCKET,
                Delete: { Objects: objects },
            }));
        }

        res.json({ retried: true, outputFilesRemoved: objects.length });
    } catch (err) {
        res.status(500).json({ error: 'Failed to retry session', detail: err.message });
    }
});

// GET /api/watcher/status - proxy to watcher health endpoint
app.get('/api/watcher/status', async (req, res) => {
    try {
        const data = await new Promise((resolve, reject) => {
            http.get(`${WATCHER_HEALTH}/health`, (resp) => {
                let body = '';
                resp.on('data', (chunk) => { body += chunk; });
                resp.on('end', () => {
                    try { resolve(JSON.parse(body)); }
                    catch { reject(new Error('Invalid JSON from watcher')); }
                });
            }).on('error', reject);
        });
        res.json(data);
    } catch (err) {
        res.json({ status: 'unreachable', error: err.message });
    }
});

// GET /api/storage/stats - S3 bucket usage
app.get('/api/storage/stats', async (req, res) => {
    try {
        let totalSize = 0;
        let totalObjects = 0;
        let continuationToken;

        do {
            const params = { Bucket: BUCKET };
            if (continuationToken) params.ContinuationToken = continuationToken;
            const result = await s3.send(new ListObjectsV2Command(params));
            for (const obj of (result.Contents || [])) {
                totalSize += obj.Size;
                totalObjects++;
            }
            continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
        } while (continuationToken);

        res.json({
            bucket: BUCKET,
            totalObjects,
            totalSizeBytes: totalSize,
            totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get storage stats', detail: err.message });
    }
});

// POST /api/sessions - create a test session
app.post('/api/sessions', async (req, res) => {
    try {
        const sessionId = req.body.sessionId || `test-${Date.now()}`;
        const prefix = `${sessionId}/`;

        const badge = {
            name: req.body.visitorName || 'Test Visitor',
            company: req.body.visitorCompany || 'Test Corp',
            title: req.body.visitorTitle || 'Engineer',
            email: req.body.visitorEmail || 'test@example.com',
        };

        const metadata = {
            visitor_name: badge.name,
            status: 'pending',
            created_at: new Date().toISOString(),
        };

        const clicks = [
            { timestamp: Date.now(), url: 'https://demo.example.com', element: 'button.cta', x: 400, y: 300 },
            { timestamp: Date.now() + 5000, url: 'https://demo.example.com/features', element: 'a.nav', x: 200, y: 50 },
        ];

        await s3.send(new PutObjectCommand({
            Bucket: BUCKET, Key: `${prefix}metadata.json`,
            Body: JSON.stringify(metadata, null, 2), ContentType: 'application/json',
        }));

        await s3.send(new PutObjectCommand({
            Bucket: BUCKET, Key: `${prefix}badge.json`,
            Body: JSON.stringify(badge, null, 2), ContentType: 'application/json',
        }));

        await s3.send(new PutObjectCommand({
            Bucket: BUCKET, Key: `${prefix}clicks.json`,
            Body: JSON.stringify(clicks, null, 2), ContentType: 'application/json',
        }));

        // ready trigger last (per S3 data contract)
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET, Key: `${prefix}ready`,
            Body: '', ContentType: 'text/plain',
        }));

        res.status(201).json({ sessionId, status: 'created' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create session', detail: err.message });
    }
});

// GET /api/sessions/:id/data - fetch all session JSON data in one call
app.get('/api/sessions/:id/data', async (req, res) => {
    const sid = req.params.id;
    const result = { session_id: sid, metadata: null, badge: null, clicks: null, transcript: null, analysis: null };

    async function fetchJson(key) {
        try {
            const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
            const r = await s3.send(cmd);
            return JSON.parse(await r.Body.transformToString());
        } catch { return null; }
    }

    try {
        const [metadata, badge, clicks, clicksAlt, transcript, analysis, analysisAlt] = await Promise.all([
            fetchJson(`${sid}/metadata.json`),
            fetchJson(`${sid}/badge.json`),
            fetchJson(`${sid}/clicks.json`),
            fetchJson(`${sid}/clicks/clicks.json`),
            fetchJson(`${sid}/transcript.json`),
            fetchJson(`${sid}/output/summary.json`),
            fetchJson(`${sid}/output/result.json`),
        ]);

        result.metadata = metadata;
        result.badge = badge;
        result.clicks = clicks || clicksAlt;
        result.transcript = transcript;
        result.analysis = analysis || analysisAlt;

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch session data', detail: err.message });
    }
});

// GET /api/sessions/:id/screenshots/:filename - proxy screenshot from S3
app.get('/api/sessions/:id/screenshots/:filename', async (req, res) => {
    const key = `${req.params.id}/screenshots/${req.params.filename}`;
    try {
        const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const r = await s3.send(cmd);
        res.setHeader('Content-Type', r.ContentType || 'image/jpeg');
        r.Body.pipe(res);
    } catch (err) {
        if (err.name === 'NoSuchKey') {
            res.status(404).json({ error: 'Screenshot not found' });
        } else {
            res.status(500).json({ error: 'Failed to fetch screenshot', detail: err.message });
        }
    }
});

// GET /api/sessions/:id/files - list all files in a session prefix
app.get('/api/sessions/:id/files', async (req, res) => {
    try {
        const prefix = `${req.params.id}/`;
        const cmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
        const r = await s3.send(cmd);
        const files = (r.Contents || []).map(o => ({
            key: o.Key,
            size: o.Size,
            lastModified: o.LastModified,
        }));
        res.json({ files });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list files', detail: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Presenter server running on http://localhost:${PORT}`);
});
