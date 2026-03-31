// S3 helpers for the session watcher
// Handles listing sessions, checking completion, and writing analysis markers

const {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');

const REGION = process.env.AWS_REGION || 'us-east-1';

let _client = null;

function getClient() {
  if (!_client) {
    _client = new S3Client({ region: REGION });
  }
  return _client;
}

// List all session IDs in the bucket (folders under sessions/)
async function listSessions(bucket) {
  const client = getClient();
  const sessions = [];
  let continuationToken;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'sessions/',
      Delimiter: '/',
      ContinuationToken: continuationToken,
    });
    const resp = await client.send(cmd);

    for (const prefix of (resp.CommonPrefixes || [])) {
      // prefix.Prefix looks like "sessions/A726594/"
      const parts = prefix.Prefix.split('/');
      const sessionId = parts[1];
      if (sessionId) sessions.push(sessionId);
    }

    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : null;
  } while (continuationToken);

  return sessions;
}

// Check if an object exists in S3 (HEAD request)
async function objectExists(bucket, key) {
  const client = getClient();
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

// Fetch and parse a JSON object from S3
async function getJson(bucket, key) {
  const client = getClient();
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await streamToString(resp.Body);
  return JSON.parse(body);
}

// Write a small JSON marker file to S3 to record that analysis was claimed
async function writeMarker(bucket, sessionId, markerData) {
  const client = getClient();
  const key = `sessions/${sessionId}/output/.analysis-claimed`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(markerData),
    ContentType: 'application/json',
  }));
}

// Check if a session has already been claimed for analysis
async function isAlreadyClaimed(bucket, sessionId) {
  return objectExists(bucket, `sessions/${sessionId}/output/.analysis-claimed`);
}

// Check whether a session is ready for analysis.
// Ready = metadata.json with status 'ended' or 'completed' + clicks/clicks.json + transcript/transcript.json
// Returns: { ready: boolean, needsTranscription: boolean } or false
async function isSessionComplete(bucket, sessionId) {
  const metadataKey = `sessions/${sessionId}/metadata.json`;
  const clicksKey = `sessions/${sessionId}/clicks/clicks.json`;
  const transcriptKey = `sessions/${sessionId}/transcript/transcript.json`;
  const audioKey = `sessions/${sessionId}/audio/recording.wav`;

  // Check metadata first — bail if still active
  let metadata;
  try {
    metadata = await getJson(bucket, metadataKey);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }

  if (metadata.status !== 'ended' && metadata.status !== 'completed') {
    return false;
  }

  // Check data files in parallel
  const [clicksExist, transcriptExist, audioExist] = await Promise.all([
    objectExists(bucket, clicksKey),
    objectExists(bucket, transcriptKey),
    objectExists(bucket, audioKey),
  ]);

  if (!clicksExist) return false;

  // If transcript exists, fully ready
  if (transcriptExist) return true;

  // If audio exists but transcript doesn't, needs transcription first
  if (audioExist) return { needsTranscription: true };

  // No transcript and no audio — can't proceed
  return false;
}

// Helper: convert readable stream to string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// List objects under a prefix. Returns array of { Key, LastModified, Size }.
async function listObjects(bucket, prefix) {
  const client = getClient();
  const results = [];
  let continuationToken;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const resp = await client.send(cmd);
    for (const obj of (resp.Contents || [])) {
      results.push({ Key: obj.Key, LastModified: obj.LastModified, Size: obj.Size });
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : null;
  } while (continuationToken);

  return results;
}

// Merge fields into an existing metadata.json for a session.
// Reads the current metadata, merges the updates, and writes it back.
async function updateMetadata(bucket, sessionId, updates) {
  const client = getClient();
  const key = `sessions/${sessionId}/metadata.json`;
  let metadata = {};
  try {
    metadata = await getJson(bucket, key);
  } catch (err) {
    if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
      throw err;
    }
  }
  Object.assign(metadata, updates);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(metadata, null, 2),
    ContentType: 'application/json',
  }));
}

module.exports = {
  listSessions,
  isSessionComplete,
  isAlreadyClaimed,
  writeMarker,
  getJson,
  listObjects,
  updateMetadata,
};
