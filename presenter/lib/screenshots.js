'use strict';

// Screenshots API — list screenshots for a session and generate presigned URLs
//
// GET /api/session/:id/screenshots

const { Router } = require('express');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function createRouter(opts) {
  const router = Router();
  const bucket = (opts && opts.bucket) || process.env.S3_BUCKET || 'boothapp-sessions-752266476357';
  const region = process.env.AWS_REGION || 'us-east-1';

  let s3;
  function getS3Client() {
    if (!s3) s3 = new S3Client({ region });
    return s3;
  }

  // GET /api/session/:id/screenshots
  router.get('/api/session/:id/screenshots', async (req, res) => {
    const sessionId = req.params.id;
    if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const client = getS3Client();
    const prefix = `sessions/${sessionId}/screenshots/`;

    try {
      // List all screenshot files
      const listCmd = new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix });
      const listResult = await client.send(listCmd);
      const objects = (listResult.Contents || [])
        .filter(obj => /\.(jpg|jpeg|png|webp)$/i.test(obj.Key))
        .sort((a, b) => a.Key.localeCompare(b.Key));

      if (objects.length === 0) {
        return res.json({ session_id: sessionId, screenshots: [], clicks: [] });
      }

      // Generate presigned URLs (valid 1 hour)
      const screenshots = await Promise.all(objects.map(async (obj) => {
        const filename = obj.Key.split('/').pop();
        const url = await getSignedUrl(client, new GetObjectCommand({
          Bucket: bucket,
          Key: obj.Key,
        }), { expiresIn: 3600 });

        return {
          key: obj.Key,
          filename,
          url,
          size: obj.Size,
          last_modified: obj.LastModified,
        };
      }));

      // Try to load clicks.json for annotation data
      let clicks = [];
      try {
        const clicksCmd = new GetObjectCommand({
          Bucket: bucket,
          Key: `sessions/${sessionId}/clicks/clicks.json`,
        });
        const clicksResult = await client.send(clicksCmd);
        const body = await clicksResult.Body.transformToString();
        const clicksData = JSON.parse(body);
        clicks = clicksData.events || [];
      } catch (_) {
        // clicks.json may not exist — that's fine
      }

      res.json({
        session_id: sessionId,
        screenshots,
        clicks,
      });
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.name === 'NoSuchBucket') {
        return res.status(404).json({ error: 'Session not found' });
      }
      console.error(`[screenshots] Error listing ${sessionId}:`, err.message);
      res.status(500).json({ error: 'Failed to list screenshots' });
    }
  });

  return router;
}

module.exports = { createRouter };
