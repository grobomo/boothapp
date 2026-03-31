'use strict';
const archiver = require('archiver');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs');
const path = require('path');

function sanitizeName(name) {
  return (name || 'Unknown')
    .trim()
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Unknown';
}

async function packageAndUpload({ sessionDir, sessionId, visitorName, audioOptedOut, bucket, region }) {
  const safeName = sanitizeName(visitorName);
  const zipName = `${safeName}_${sessionId}.zip`;
  const zipPath = path.join(sessionDir, zipName);

  console.log(`\n  [packager] Creating ${zipName} ...`);

  // Create zip
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    // Add screenshots
    const screenshotsDir = path.join(sessionDir, 'screenshots');
    if (fs.existsSync(screenshotsDir)) {
      archive.directory(screenshotsDir, 'screenshots');
    }

    // Add MP3 if audio was not opted out
    const mp3Path = path.join(sessionDir, 'recording.mp3');
    if (!audioOptedOut && fs.existsSync(mp3Path)) {
      archive.file(mp3Path, { name: 'audio/recording.mp3' });
    }

    // Add clicks
    const clicksPath = path.join(sessionDir, 'clicks.json');
    if (fs.existsSync(clicksPath)) {
      archive.file(clicksPath, { name: 'clicks/clicks.json' });
    }

    archive.finalize();
  });

  const zipStat = fs.statSync(zipPath);
  const sizeMB = (zipStat.size / 1024 / 1024).toFixed(1);
  console.log(`  [packager] Zip created: ${sizeMB} MB`);

  // Upload zip to S3
  console.log(`  [packager] Uploading to s3://${bucket}/sessions/${sessionId}/${zipName} ...`);
  const s3 = new S3Client({ region });
  const zipKey = `sessions/${sessionId}/${zipName}`;

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: zipKey,
      Body: fs.createReadStream(zipPath),
      ContentType: 'application/zip',
    },
  });

  upload.on('httpUploadProgress', (p) => {
    if (p.total) {
      process.stderr.write(`\r  [packager] Upload: ${Math.round((p.loaded / p.total) * 100)}%`);
    }
  });

  await upload.done();
  console.log(`\n  [packager] Upload complete: ${zipKey}`);

  // Build and upload manifest
  const screenshotsDir = path.join(sessionDir, 'screenshots');
  const screenshotFiles = fs.existsSync(screenshotsDir) ? fs.readdirSync(screenshotsDir) : [];
  const mp3Exists = !audioOptedOut && fs.existsSync(path.join(sessionDir, 'recording.mp3'));
  const clicksExist = fs.existsSync(path.join(sessionDir, 'clicks.json'));

  const manifest = {
    session_id: sessionId,
    visitor_name: visitorName,
    zip_key: zipKey,
    zip_size_bytes: zipStat.size,
    screenshot_count: screenshotFiles.length,
    has_audio: mp3Exists,
    has_clicks: clicksExist,
    audio_opted_out: audioOptedOut,
    created_at: new Date().toISOString(),
  };

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `sessions/${sessionId}/package-manifest.json`,
    Body: JSON.stringify(manifest, null, 2),
    ContentType: 'application/json',
  }));

  console.log(`  [packager] Manifest written: sessions/${sessionId}/package-manifest.json`);
  return manifest;
}

module.exports = { packageAndUpload, sanitizeName };
