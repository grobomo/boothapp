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

// Check whether a session is fully complete and ready for analysis
// Complete = metadata.json with status 'completed' + clicks/clicks.json + transcript/transcript.json
async function isSessionComplete(bucket, sessionId) {
  const metadataKey = `sessions/${sessionId}/metadata.json`;
  const clicksKey = `sessions/${sessionId}/clicks/clicks.json`;
  const transcriptKey = `sessions/${sessionId}/transcript/transcript.json`;

  // Check all three files exist in parallel
  const [clicksExist, transcriptExist] = await Promise.all([
    objectExists(bucket, clicksKey),
    objectExists(bucket, transcriptKey),
  ]);

  if (!clicksExist || !transcriptExist) {
    return false;
  }

  // Check metadata last (cheapest path: bail early if data files missing)
  let metadata;
  try {
    metadata = await getJson(bucket, metadataKey);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }

  return metadata.status === 'completed';
}

// Helper: convert readable stream to string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

module.exports = {
  listSessions,
  isSessionComplete,
  isAlreadyClaimed,
  writeMarker,
  getJson,
};
