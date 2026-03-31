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
                company: null,
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
                const meta = JSON.parse(await metaResult.Body.transformToString());
                session.visitor_name = meta.visitor_name || null;
                session.company = meta.company || null;
                session.status = meta.status || 'unknown';
                session.created_at = meta.created_at || null;
            } catch { /* metadata missing */ }

            try {
                const summaryCmd = new GetObjectCommand({
                    Bucket: BUCKET,
                    Key: `${sessionId}/summary.html`,
                });
                await s3.send(summaryCmd);
                session.has_analysis = true;
                session.summary_link = `/api/sessions/${sessionId}/summary`;
            } catch { /* no summary */ }

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

// GET /api/sessions/:id/analysis - structured analysis data for comparison
app.get('/api/sessions/:id/analysis', async (req, res) => {
    try {
        const sessionId = req.params.id;
        const analysis = {
            session_id: sessionId,
            visitor_name: null,
            company: null,
            products_demonstrated: [],
            key_interests: [],
            engagement_score: 'unknown',
            follow_up_actions: [],
            duration_minutes: null,
            created_at: null,
        };

        // Fetch metadata
        try {
            const metaCmd = new GetObjectCommand({
                Bucket: BUCKET,
                Key: `${sessionId}/metadata.json`,
            });
            const metaResult = await s3.send(metaCmd);
            const meta = JSON.parse(await metaResult.Body.transformToString());
            analysis.visitor_name = meta.visitor_name || null;
            analysis.company = meta.company || null;
            analysis.created_at = meta.created_at || null;
            analysis.duration_minutes = meta.duration_minutes || null;
        } catch { /* metadata missing */ }

        // Fetch analysis.json (produced by pipeline)
        try {
            const analysisCmd = new GetObjectCommand({
                Bucket: BUCKET,
                Key: `${sessionId}/analysis.json`,
            });
            const analysisResult = await s3.send(analysisCmd);
            const data = JSON.parse(await analysisResult.Body.transformToString());
            analysis.products_demonstrated = data.products_demonstrated || data.topics || [];
            analysis.key_interests = data.key_interests || data.interests || [];
            analysis.engagement_score = data.engagement_score || data.avgEngagement || 'unknown';
            analysis.follow_up_actions = data.follow_up_actions || data.recommendations || [];
        } catch { /* analysis missing */ }

        res.json(analysis);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch analysis', detail: err.message });
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

app.listen(PORT, () => {
    console.log(`Presenter server running on http://localhost:${PORT}`);
});
