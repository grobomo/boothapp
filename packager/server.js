'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT, 10) || 9222;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 2000;
const S3_BUCKET = process.env.S3_BUCKET || 'boothapp-sessions-752266476357';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

let s3Client = null;
function getS3() {
  if (!s3Client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return s3Client;
}

// State
let activeSession = null;
let audioProcess = null;
let audioFile = null;
let sessionScreenshots = [];
let sessionClicks = null;

function log(msg) {
  console.log(`${new Date().toISOString()} [packager] ${msg}`);
}

// --- Audio Recording ---

function findAudioDevice() {
  // Prefer known USB mics by keyword scoring
  const keywords = ['yeti', 'rode', 'shure', 'blue', 'usb', 'microphone', 'audio'];
  try {
    // On Linux, list ALSA devices
    const result = require('child_process').execSync('arecord -l 2>/dev/null || echo "none"', { encoding: 'utf-8' });
    if (result.includes('none')) return process.env.AUDIO_DEVICE || 'default';

    let bestDevice = 'default';
    let bestScore = 0;
    for (const line of result.split('\n')) {
      const lower = line.toLowerCase();
      const score = keywords.reduce((s, kw) => s + (lower.includes(kw) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        const match = line.match(/card (\d+).*device (\d+)/);
        if (match) bestDevice = `hw:${match[1]},${match[2]}`;
      }
    }
    return bestDevice;
  } catch (_) {
    return process.env.AUDIO_DEVICE || 'default';
  }
}

function startAudioRecording(sessionDir) {
  const wavFile = path.join(sessionDir, 'audio', 'recording.wav');
  fs.mkdirSync(path.join(sessionDir, 'audio'), { recursive: true });

  const device = findAudioDevice();
  log(`Starting audio recording (device: ${device})`);

  // Try ffmpeg first, fall back to arecord
  audioFile = wavFile;
  try {
    audioProcess = spawn('ffmpeg', [
      '-f', 'alsa', '-i', device,
      '-ar', '44100', '-ac', '2',
      '-y', wavFile,
    ], { stdio: 'ignore' });

    audioProcess.on('error', () => {
      log('ffmpeg not available, trying arecord');
      audioProcess = spawn('arecord', [
        '-D', device, '-f', 'S16_LE', '-r', '44100', '-c', '2',
        wavFile,
      ], { stdio: 'ignore' });
      audioProcess.on('error', () => {
        log('Audio recording not available (no ffmpeg or arecord)');
        audioProcess = null;
      });
    });
  } catch (_) {
    log('Audio recording not available');
    audioProcess = null;
  }
}

function stopAudioRecording() {
  if (audioProcess) {
    audioProcess.kill('SIGINT');
    audioProcess = null;
    log('Audio recording stopped');
  }
}

function convertWavToMp3(wavFile, mp3File) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-i', wavFile,
      '-codec:a', 'libmp3lame', '-qscale:a', '2',
      '-y', mp3File,
    ], { stdio: 'ignore' });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        log('WAV to MP3 conversion failed, keeping WAV');
        resolve(false);
      }
    });

    proc.on('error', () => {
      log('ffmpeg not available for MP3 conversion');
      resolve(false);
    });
  });
}

// --- S3 Polling ---

async function pollActiveSession() {
  try {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: 'active-session.json' });
    const result = await getS3().send(cmd);
    const body = await result.Body.transformToString();
    const data = JSON.parse(body);

    if (data.active && !activeSession) {
      // New session started
      activeSession = data;
      const sessionDir = path.join(DATA_DIR, data.session_id);
      fs.mkdirSync(path.join(sessionDir, 'screenshots'), { recursive: true });
      fs.mkdirSync(path.join(sessionDir, 'clicks'), { recursive: true });
      sessionScreenshots = [];
      sessionClicks = null;

      log(`Session started: ${data.session_id}`);
      startAudioRecording(sessionDir);
    } else if (data.active && activeSession && data.stop_audio && audioProcess) {
      // Stop audio mid-session
      stopAudioRecording();
      log('Audio opted out mid-session');
    }
  } catch (err) {
    if (err.name === 'NoSuchKey' && activeSession) {
      // Session ended (active-session.json deleted)
      log(`Session ended: ${activeSession.session_id}`);
      await packageSession(activeSession.session_id);
      activeSession = null;
    }
    // Other errors: just continue polling
  }
}

// --- Packaging ---

async function packageSession(sessionId) {
  const sessionDir = path.join(DATA_DIR, sessionId);

  stopAudioRecording();

  // Convert WAV to MP3
  const wavFile = path.join(sessionDir, 'audio', 'recording.wav');
  const mp3File = path.join(sessionDir, 'audio', 'recording.mp3');
  if (fs.existsSync(wavFile)) {
    const converted = await convertWavToMp3(wavFile, mp3File);
    if (converted && fs.existsSync(mp3File)) {
      fs.unlinkSync(wavFile);
    }
  }

  // Create zip
  log(`Packaging session ${sessionId}`);
  try {
    const archiver = require('archiver');
    const zipPath = path.join(DATA_DIR, `${sessionId}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      // Add screenshots
      const ssDir = path.join(sessionDir, 'screenshots');
      if (fs.existsSync(ssDir)) {
        archive.directory(ssDir, 'screenshots');
      }

      // Add audio
      const audioDir = path.join(sessionDir, 'audio');
      if (fs.existsSync(audioDir)) {
        const audioFiles = fs.readdirSync(audioDir);
        if (audioFiles.length > 0) {
          archive.directory(audioDir, 'audio');
        }
      }

      // Add clicks
      const clicksDir = path.join(sessionDir, 'clicks');
      if (fs.existsSync(clicksDir)) {
        archive.directory(clicksDir, 'clicks');
      }

      archive.finalize();
    });

    // Upload zip to S3
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const zipBuffer = fs.readFileSync(zipPath);
    await getS3().send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `sessions/${sessionId}/${sessionId}.zip`,
      Body: zipBuffer,
      ContentType: 'application/zip',
    }));

    // Write package manifest
    const manifest = {
      session_id: sessionId,
      packaged_at: new Date().toISOString(),
      zip_key: `sessions/${sessionId}/${sessionId}.zip`,
      zip_size: zipBuffer.length,
      has_audio: fs.existsSync(mp3File),
      screenshot_count: fs.existsSync(path.join(sessionDir, 'screenshots'))
        ? fs.readdirSync(path.join(sessionDir, 'screenshots')).length
        : 0,
    };

    await getS3().send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `sessions/${sessionId}/package-manifest.json`,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }));

    log(`Package uploaded: ${sessionId}.zip (${zipBuffer.length} bytes)`);

    // Cleanup local data
    fs.rmSync(sessionDir, { recursive: true, force: true });
    fs.unlinkSync(zipPath);
  } catch (err) {
    log(`Packaging failed: ${err.message}`);
  }
}

// --- HTTP Server ---
// Receives screenshots and clicks from Chrome extension

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      active_session: activeSession ? activeSession.session_id : null,
      audio_recording: !!audioProcess,
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/screenshot') {
    let body = [];
    req.on('data', (chunk) => body.push(chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(body).toString());
        if (activeSession && data.filename && data.data) {
          const sessionDir = path.join(DATA_DIR, activeSession.session_id, 'screenshots');
          fs.mkdirSync(sessionDir, { recursive: true });
          const imgData = data.data.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(path.join(sessionDir, data.filename), Buffer.from(imgData, 'base64'));
          sessionScreenshots.push(data.filename);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (_) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid data' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/clicks') {
    let body = [];
    req.on('data', (chunk) => body.push(chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(body).toString());
        if (activeSession) {
          const clicksDir = path.join(DATA_DIR, activeSession.session_id, 'clicks');
          fs.mkdirSync(clicksDir, { recursive: true });
          fs.writeFileSync(path.join(clicksDir, 'clicks.json'), JSON.stringify(data, null, 2));
          sessionClicks = data;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (_) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid data' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/end') {
    // Extension signals session end
    if (activeSession) {
      const sid = activeSession.session_id;
      packageSession(sid).catch((err) => log(`Package error: ${err.message}`));
      activeSession = null;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// --- Start ---

server.listen(PORT, () => {
  log(`Packager service running on http://localhost:${PORT}`);
  log(`S3 bucket: ${S3_BUCKET}`);

  // Start polling
  setInterval(() => {
    pollActiveSession().catch((err) => {
      // Silently handle polling errors
    });
  }, POLL_INTERVAL_MS);
});
