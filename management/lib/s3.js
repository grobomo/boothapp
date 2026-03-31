const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.S3_BUCKET || 'boothapp-sessions-752266476357';
const REGION = process.env.AWS_REGION || 'us-east-1';

const s3 = new S3Client({ region: REGION });

async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: typeof body === 'string' ? body : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    ContentType: contentType || 'application/json'
  }));
}

async function putJson(key, data) {
  await putObject(key, JSON.stringify(data, null, 2), 'application/json');
}

async function getObject(key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return resp.Body.transformToString();
}

async function getJson(key) {
  const text = await getObject(key);
  return JSON.parse(text);
}

async function headObject(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

async function listKeys(prefix) {
  const keys = [];
  let continuationToken;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken
    }));
    if (resp.Contents) {
      for (const obj of resp.Contents) keys.push(obj.Key);
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

module.exports = { s3, BUCKET, REGION, putObject, putJson, getObject, getJson, headObject, deleteObject, listKeys };
