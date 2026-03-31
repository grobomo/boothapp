const express = require('express');
const path = require('path');
const http = require('http');
const { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand, PutObjectCommand, HeadObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3');

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
                session.archived = meta.archived || false;
                session.archived_at = meta.archived_at || null;
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

// Large file patterns to remove from active storage after archival
const LARGE_FILE_PATTERNS = ['screenshots/', 'audio.webm', 'screen-recording.webm'];

// POST /api/sessions/:id/archive - archive a single session to archive/ prefix
app.post('/api/sessions/:id/archive', async (req, res) => {
    try {
        const sessionId = req.params.id;
        const prefix = `${sessionId}/`;

        // List all objects in the session
        const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
        const listResult = await s3.send(listCmd);
        const objects = listResult.Contents || [];

        if (objects.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // 1. Copy all objects to archive/ prefix
        const copied = [];
        for (const obj of objects) {
            const destKey = `archive/${obj.Key}`;
            await s3.send(new CopyObjectCommand({
                Bucket: BUCKET,
                CopySource: `${BUCKET}/${obj.Key}`,
                Key: destKey,
            }));
            copied.push(destKey);
        }

        // 2. Remove large files from active storage
        const removed = [];
        for (const obj of objects) {
            const relPath = obj.Key.replace(prefix, '');
            const isLarge = LARGE_FILE_PATTERNS.some(p => relPath.startsWith(p));
            if (isLarge) {
                await s3.send(new DeleteObjectsCommand({
                    Bucket: BUCKET,
                    Delete: { Objects: [{ Key: obj.Key }] },
                }));
                removed.push(obj.Key);
            }
        }

        // 3. Update metadata to mark as archived
        try {
            const metaCmd = new GetObjectCommand({
                Bucket: BUCKET,
                Key: `${sessionId}/metadata.json`,
            });
            const metaResult = await s3.send(metaCmd);
            const body = await metaResult.Body.transformToString();
            const meta = JSON.parse(body);
            meta.archived = true;
            meta.archived_at = new Date().toISOString();
            meta.archive_prefix = `archive/${sessionId}/`;

            await s3.send(new PutObjectCommand({
                Bucket: BUCKET,
                Key: `${sessionId}/metadata.json`,
                Body: JSON.stringify(meta, null, 2),
                ContentType: 'application/json',
            }));
        } catch {
            // metadata update failed, but archival still succeeded
        }

        res.json({
            archived: true,
            sessionId,
            copiedToArchive: copied.length,
            largeFilesRemoved: removed.length,
            removedFiles: removed,
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to archive session', detail: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Presenter server running on http://localhost:${PORT}`);
});
