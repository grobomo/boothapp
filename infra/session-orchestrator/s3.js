'use strict';
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET = process.env.S3_BUCKET;

async function putObject(key, body, opts = {}) {
  const params = {
    Bucket: BUCKET,
    Key: key,
    Body: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
    ContentType: opts.contentType || 'application/json',
  };
  if (opts.ifNoneMatch) params.IfNoneMatch = '*';
  await client.send(new PutObjectCommand(params));
}

async function getObject(key) {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const text = await res.Body.transformToString();
  return JSON.parse(text);
}

async function objectExists(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return false;
    throw err;
  }
}

async function deleteObject(key) {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

async function listPrefixes(prefix, delimiter) {
  const res = await client.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
    Delimiter: delimiter,
  }));
  return (res.CommonPrefixes || []).map(p => p.Prefix);
}

module.exports = { putObject, getObject, objectExists, deleteObject, listPrefixes };
