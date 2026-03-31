'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { sanitizeName } = require('../lib/packager');

// ---- sanitizeName tests ----

function testSanitizeName() {
  assert.strictEqual(sanitizeName('Sarah Mitchell'), 'Sarah_Mitchell');
  assert.strictEqual(sanitizeName('José García'), 'Jos_Garca');
  assert.strictEqual(sanitizeName(''), 'Unknown');
  assert.strictEqual(sanitizeName(null), 'Unknown');
  assert.strictEqual(sanitizeName(undefined), 'Unknown');
  assert.strictEqual(sanitizeName('  Multiple   Spaces  '), 'Multiple_Spaces');
  assert.strictEqual(sanitizeName('O\'Brien'), 'OBrien');
  assert.strictEqual(sanitizeName('Name/With<Special>Chars!'), 'NameWithSpecialChars');
  console.log('  [PASS] sanitizeName');
}

// ---- Zip structure test ----

async function testZipStructure() {
  const archiver = require('archiver');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packager-test-'));
  const sessionDir = path.join(tmpDir, 'TEST123');
  fs.mkdirSync(path.join(sessionDir, 'screenshots'), { recursive: true });

  fs.writeFileSync(path.join(sessionDir, 'screenshots', 'screenshot_00m00s000.jpg'), 'fake-jpg-1');
  fs.writeFileSync(path.join(sessionDir, 'screenshots', 'screenshot_00m01s012.jpg'), 'fake-jpg-2');
  fs.writeFileSync(path.join(sessionDir, 'recording.mp3'), 'fake-mp3-data');

  const clicksData = [{ x: 100, y: 200, url: 'https://example.com', timestamp: Date.now() }];
  fs.writeFileSync(path.join(sessionDir, 'clicks.json'), JSON.stringify(clicksData));

  const safeName = sanitizeName('Sarah Mitchell');
  const zipName = `${safeName}_TEST123.zip`;
  const zipPath = path.join(sessionDir, zipName);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    archive.directory(path.join(sessionDir, 'screenshots'), 'screenshots');
    archive.file(path.join(sessionDir, 'recording.mp3'), { name: 'audio/recording.mp3' });
    archive.file(path.join(sessionDir, 'clicks.json'), { name: 'clicks/clicks.json' });
    archive.finalize();
  });

  assert.ok(fs.existsSync(zipPath), 'Zip file should exist');
  assert.ok(fs.statSync(zipPath).size > 0, 'Zip should not be empty');

  const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf-8' });
  assert.ok(listing.includes('screenshots/screenshot_00m00s000.jpg'), 'Zip should contain screenshot 1');
  assert.ok(listing.includes('screenshots/screenshot_00m01s012.jpg'), 'Zip should contain screenshot 2');
  assert.ok(listing.includes('audio/recording.mp3'), 'Zip should contain audio/recording.mp3');
  assert.ok(listing.includes('clicks/clicks.json'), 'Zip should contain clicks/clicks.json');
  assert.strictEqual(zipName, 'Sarah_Mitchell_TEST123.zip');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  [PASS] zip structure (screenshots/, audio/, clicks/)');
}

// ---- Zip without audio (opted out) ----

async function testZipNoAudio() {
  const archiver = require('archiver');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packager-test-noaudio-'));
  const sessionDir = path.join(tmpDir, 'TEST456');
  fs.mkdirSync(path.join(sessionDir, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'screenshots', 'screenshot_00m00s000.jpg'), 'fake');
  fs.writeFileSync(path.join(sessionDir, 'clicks.json'), '[]');

  const zipPath = path.join(sessionDir, 'Unknown_TEST456.zip');

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(path.join(sessionDir, 'screenshots'), 'screenshots');
    archive.file(path.join(sessionDir, 'clicks.json'), { name: 'clicks/clicks.json' });
    archive.finalize();
  });

  const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf-8' });
  assert.ok(!listing.includes('audio/'), 'Zip should NOT contain audio/ when opted out');
  assert.ok(listing.includes('screenshots/'), 'Zip should still contain screenshots/');
  assert.ok(listing.includes('clicks/clicks.json'), 'Zip should still contain clicks/');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  [PASS] zip without audio (opted out)');
}

// ---- Manifest format test ----

function testManifestFormat() {
  const manifest = {
    session_id: 'ABC12345',
    visitor_name: 'Sarah Mitchell',
    zip_key: 'sessions/ABC12345/Sarah_Mitchell_ABC12345.zip',
    zip_size_bytes: 1024,
    screenshot_count: 5,
    has_audio: true,
    has_clicks: true,
    audio_opted_out: false,
    created_at: new Date().toISOString(),
  };

  assert.ok(manifest.session_id, 'Manifest must have session_id');
  assert.ok(manifest.visitor_name, 'Manifest must have visitor_name');
  assert.ok(manifest.zip_key, 'Manifest must have zip_key');
  assert.strictEqual(typeof manifest.zip_size_bytes, 'number');
  assert.strictEqual(typeof manifest.screenshot_count, 'number');
  assert.strictEqual(typeof manifest.has_audio, 'boolean');
  assert.strictEqual(typeof manifest.has_clicks, 'boolean');
  assert.strictEqual(typeof manifest.audio_opted_out, 'boolean');
  assert.ok(manifest.created_at, 'Manifest must have created_at');

  console.log('  [PASS] manifest format');
}

// ---- Audio conversion test (WAV -> MP3) ----

async function testAudioConversion() {
  const { AudioManager } = require('../lib/audio-manager');
  const audio = new AudioManager();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-test-'));
  const wavPath = path.join(tmpDir, 'recording.wav');

  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 1 "${wavPath}" 2>/dev/null`);
  assert.ok(fs.existsSync(wavPath), 'WAV file should exist');
  assert.ok(fs.statSync(wavPath).size > 0, 'WAV should not be empty');

  const mp3Path = await audio.convertToMp3(wavPath);
  assert.ok(fs.existsSync(mp3Path), 'MP3 file should exist');
  assert.ok(mp3Path.endsWith('.mp3'), 'Output should be .mp3');
  assert.ok(fs.statSync(mp3Path).size > 0, 'MP3 should not be empty');

  const probe = execSync(`ffprobe -v error -show_entries format=format_name "${mp3Path}" 2>&1`, { encoding: 'utf-8' });
  assert.ok(probe.includes('mp3'), 'File should be valid MP3');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  [PASS] WAV -> MP3 conversion (libmp3lame VBR q2)');
}

// ---- Session manager addScreenshot/addClicks tests ----

function testSessionManagerStorage() {
  const { SessionManager } = require('../lib/session-manager');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-test-'));
  const mgr = new SessionManager({ outputDir: tmpDir });

  assert.strictEqual(mgr.addScreenshot('test.jpg', Buffer.from('data')), false);
  assert.strictEqual(mgr.addClicks('[]'), false);

  mgr.session = { session_id: 'SESS1', visitor_name: 'Test User' };
  mgr.screenshotCount = 0;
  const sessDir = path.join(tmpDir, 'SESS1', 'screenshots');
  fs.mkdirSync(sessDir, { recursive: true });

  const result = mgr.addScreenshot('screenshot_00m05s123.jpg', Buffer.from('fake-jpg'));
  assert.strictEqual(result, true);
  assert.strictEqual(mgr.screenshotCount, 1);
  assert.ok(fs.existsSync(path.join(sessDir, 'screenshot_00m05s123.jpg')));

  const clicks = JSON.stringify([{ x: 10, y: 20 }]);
  assert.strictEqual(mgr.addClicks(clicks), true);
  assert.ok(fs.existsSync(path.join(tmpDir, 'SESS1', 'clicks.json')));
  assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'SESS1', 'clicks.json'), 'utf-8'), clicks);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  [PASS] session manager addScreenshot/addClicks');
}

// ---- Status endpoint format test ----

function testStatusFormat() {
  const { SessionManager } = require('../lib/session-manager');
  const mgr = new SessionManager();

  let status = mgr.getStatus();
  assert.strictEqual(status.session_id, null);
  assert.strictEqual(status.active, false);
  assert.strictEqual(status.screenshot_count, 0);
  assert.strictEqual(status.audio_recording, false);
  assert.strictEqual(status.audio_opted_out, false);
  assert.strictEqual(status.packaging, false);

  mgr.session = { session_id: 'X1' };
  mgr.screenshotCount = 42;
  status = mgr.getStatus();
  assert.strictEqual(status.session_id, 'X1');
  assert.strictEqual(status.active, true);
  assert.strictEqual(status.screenshot_count, 42);

  console.log('  [PASS] status endpoint format');
}

// ---- HTTP server endpoint tests ----

async function testHttpEndpoints() {
  const http = require('http');
  const { SessionManager } = require('../lib/session-manager');
  const mgr = new SessionManager({ outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'http-test-')) });

  function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
  }
  function json(res, status, data) {
    cors(res);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const { method, url } = req;
    if (method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

    if (method === 'POST' && url === '/screenshots') {
      if (!mgr.session) return json(res, 409, { error: 'No active session' });
      const filename = req.headers['x-filename'] || `screenshot_${Date.now()}.jpg`;
      const body = await readBody(req);
      mgr.addScreenshot(filename, body);
      return json(res, 200, { ok: true, count: mgr.screenshotCount });
    }
    if (method === 'POST' && url === '/clicks') {
      if (!mgr.session) return json(res, 409, { error: 'No active session' });
      const body = await readBody(req);
      mgr.addClicks(body.toString('utf-8'));
      return json(res, 200, { ok: true });
    }
    if (method === 'GET' && url === '/status') {
      return json(res, 200, mgr.getStatus());
    }
    json(res, 404, { error: 'Not found' });
  });

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  const base = `http://127.0.0.1:${port}`;

  async function fetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = http.request({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: opts.method || 'GET',
        headers: opts.headers || {},
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode, body: JSON.parse(body), headers: res.headers });
        });
      });
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  // GET /status -- no session
  let r = await fetch(`${base}/status`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.active, false);
  assert.ok(r.headers['access-control-allow-origin'] === '*', 'CORS headers present');

  // POST /screenshots -- no session
  r = await fetch(`${base}/screenshots`, { method: 'POST', body: 'data' });
  assert.strictEqual(r.status, 409);

  // POST /clicks -- no session
  r = await fetch(`${base}/clicks`, { method: 'POST', body: '[]' });
  assert.strictEqual(r.status, 409);

  // 404 for unknown route
  r = await fetch(`${base}/unknown`);
  assert.strictEqual(r.status, 404);

  // Simulate session
  mgr.session = { session_id: 'HTTP-TEST', visitor_name: 'Tester' };
  mgr.screenshotCount = 0;
  const sessDir = path.join(mgr.outputDir, 'HTTP-TEST', 'screenshots');
  fs.mkdirSync(sessDir, { recursive: true });

  // POST /screenshots -- with session
  r = await fetch(`${base}/screenshots`, {
    method: 'POST',
    headers: { 'X-Filename': 'screenshot_00m00s000.jpg' },
    body: 'fake-jpg-data',
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.count, 1);

  // POST /clicks -- with session
  r = await fetch(`${base}/clicks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ x: 1, y: 2 }]),
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);

  // Verify files on disk
  assert.ok(fs.existsSync(path.join(sessDir, 'screenshot_00m00s000.jpg')));
  assert.ok(fs.existsSync(path.join(mgr.outputDir, 'HTTP-TEST', 'clicks.json')));

  // GET /status -- with session
  r = await fetch(`${base}/status`);
  assert.strictEqual(r.body.active, true);
  assert.strictEqual(r.body.session_id, 'HTTP-TEST');
  assert.strictEqual(r.body.screenshot_count, 1);

  server.close();
  fs.rmSync(mgr.outputDir, { recursive: true, force: true });
  console.log('  [PASS] HTTP endpoints (status, screenshots, clicks, CORS, 404, 409)');
}

// ---- Run all tests ----

async function main() {
  console.log('\n  Packager Test Suite');
  console.log('  ==================\n');

  testSanitizeName();
  await testZipStructure();
  await testZipNoAudio();
  testManifestFormat();
  await testAudioConversion();
  testSessionManagerStorage();
  testStatusFormat();
  await testHttpEndpoints();

  console.log('\n  All tests passed!\n');
}

main().catch((err) => {
  console.error(`\n  [FAIL] ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
