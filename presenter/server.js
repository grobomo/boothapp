const express = require('express');
const path = require('path');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BUCKET = process.env.S3_BUCKET || 'boothapp-sessions';
const REGION = process.env.AWS_REGION || 'us-east-1';
const LAMBDA_FUNCTION = process.env.LAMBDA_FUNCTION || 'boothapp-session-manager';

const s3 = new S3Client({ region: REGION });
const lambda = new LambdaClient({ region: REGION });

// ---------------------------------------------------------------------------
// Helper: read a JSON object from S3
// ---------------------------------------------------------------------------
async function getS3Json(key) {
    try {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        const body = await res.Body.transformToString();
        return JSON.parse(body);
    } catch (err) {
        if (err.name === 'NoSuchKey') return null;
        throw err;
    }
}

// ---------------------------------------------------------------------------
// HTML routes
// ---------------------------------------------------------------------------
app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/sessions', (_req, res) => {
    res.sendFile(path.join(__dirname, 'sessions.html'));
});

app.get('/session/:id', (_req, res) => {
    res.sendFile(path.join(__dirname, 'session-viewer.html'));
});

// Serve static assets (CSS, images, etc.) - after explicit routes
app.use(express.static(path.join(__dirname)));

// ---------------------------------------------------------------------------
// GET /api/sessions - list all sessions with metadata and analysis status
// ---------------------------------------------------------------------------
app.get('/api/sessions', async (req, res) => {
    try {
        const listCmd = new ListObjectsV2Command({
            Bucket: BUCKET,
            Delimiter: '/',
        });
        const listResult = await s3.send(listCmd);
        const prefixes = (listResult.CommonPrefixes || []).map(p => p.Prefix);

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
                // metadata.json missing or unreadable
            }

            try {
                const summaryKey = `${sessionId}/summary.html`;
                await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: summaryKey }));
                session.has_analysis = true;
                session.summary_link = `/api/sessions/${sessionId}/summary`;
            } catch {
                // No summary
            }

            return session;
        }));

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

// ---------------------------------------------------------------------------
// GET /api/sessions/:id/summary - proxy the summary HTML from S3
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// GET /api/session/:id - full session data (metadata, clicks, transcript, analysis)
// ---------------------------------------------------------------------------
app.get('/api/session/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [metadata, clicks, transcript, analysis] = await Promise.all([
            getS3Json(`${id}/metadata.json`),
            getS3Json(`${id}/clicks.json`),
            getS3Json(`${id}/transcript.json`),
            getS3Json(`${id}/analysis.json`),
        ]);

        if (!metadata) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({ id, metadata, clicks, transcript, analysis });
    } catch (err) {
        console.error(`GET /api/session/${req.params.id} error:`, err);
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/session/:id/screenshots - signed S3 URLs for screenshots
// ---------------------------------------------------------------------------
app.get('/api/session/:id/screenshots', async (req, res) => {
    try {
        const { id } = req.params;
        const prefix = `${id}/screenshots/`;

        const listRes = await s3.send(new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix,
        }));

        const objects = (listRes.Contents || []).filter(o => o.Key !== prefix);
        const screenshots = [];

        for (const obj of objects) {
            const url = await getSignedUrl(s3, new GetObjectCommand({
                Bucket: BUCKET,
                Key: obj.Key,
            }), { expiresIn: 3600 });

            screenshots.push({
                key: obj.Key,
                filename: path.basename(obj.Key),
                size: obj.Size,
                lastModified: obj.LastModified,
                url,
            });
        }

        res.json({ id, screenshots });
    } catch (err) {
        console.error(`GET /api/session/${req.params.id}/screenshots error:`, err);
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/session - create a new session (invoke Lambda)
// ---------------------------------------------------------------------------
app.post('/api/session', async (req, res) => {
    try {
        const payload = { action: 'create', ...req.body };

        const lambdaRes = await lambda.send(new InvokeCommand({
            FunctionName: LAMBDA_FUNCTION,
            Payload: Buffer.from(JSON.stringify(payload)),
        }));

        const result = JSON.parse(Buffer.from(lambdaRes.Payload).toString());
        res.json(result);
    } catch (err) {
        console.error('POST /api/session error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/session/:id/end - end a session
// ---------------------------------------------------------------------------
app.post('/api/session/:id/end', async (req, res) => {
    try {
        const { id } = req.params;
        const payload = { action: 'end', sessionId: id, ...req.body };

        const lambdaRes = await lambda.send(new InvokeCommand({
            FunctionName: LAMBDA_FUNCTION,
            Payload: Buffer.from(JSON.stringify(payload)),
        }));

        const result = JSON.parse(Buffer.from(lambdaRes.Payload).toString());
        res.json(result);
    } catch (err) {
        console.error(`POST /api/session/${req.params.id}/end error:`, err);
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`BoothApp Presenter server running on http://localhost:${PORT}`);
});
