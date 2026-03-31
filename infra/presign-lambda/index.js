const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const BUCKET = process.env.BUCKET_NAME || "boothapp-sessions-752266476357";
const EXPIRES_IN = 3600;
const ALLOWED_TYPES = new Set(["clicks", "screenshot", "metadata", "audio"]);

const CONTENT_TYPES = {
  clicks: "application/json",
  screenshot: "image/png",
  metadata: "application/json",
  audio: "audio/webm",
};

const s3 = new S3Client({});

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const { session_id, file_type } = body;

  if (!session_id || typeof session_id !== "string") {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing or invalid session_id" }),
    };
  }

  if (!ALLOWED_TYPES.has(file_type)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: `Invalid file_type. Must be one of: ${[...ALLOWED_TYPES].join(", ")}`,
      }),
    };
  }

  const ext = file_type === "screenshot" ? ".png" : file_type === "audio" ? ".webm" : ".json";
  const key = `sessions/${session_id}/${file_type}${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: CONTENT_TYPES[file_type],
  });

  const upload_url = await getSignedUrl(s3, command, { expiresIn: EXPIRES_IN });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ upload_url, expires_in: EXPIRES_IN }),
  };
};
