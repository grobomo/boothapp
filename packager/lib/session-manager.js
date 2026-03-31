'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const { AudioManager } = require('./audio-manager');
const { packageAndUpload } = require('./packager');

class SessionManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.bucket = opts.bucket || process.env.S3_BUCKET || 'boothapp-sessions-752266476357';
    this.region = opts.region || process.env.AWS_REGION || 'us-east-1';
    this.pollIntervalMs = opts.pollIntervalMs || parseInt(process.env.POLL_INTERVAL_MS, 10) || 2000;
    this.outputDir = opts.outputDir || path.join(process.cwd(), 'sessions');

    this.s3 = new S3Client({ region: this.region });
    this.audio = new AudioManager();
    this.poller = null;

    // Session state
    this.session = null;
    this.screenshotCount = 0;
    this.audioOptedOut = false;
    this.packaging = false;
  }

  startPolling() {
    console.log(`  [session] Polling s3://${this.bucket}/active-session.json every ${this.pollIntervalMs}ms`);
    this.poller = setInterval(() => this._poll(), this.pollIntervalMs);
    this._poll();
  }

  stopPolling() {
    if (this.poller) { clearInterval(this.poller); this.poller = null; }
  }

  async _poll() {
    try {
      const data = await this._getActiveSession();

      if (data && data.active && data.session_id) {
        // Session is active
        if (!this.session || this.session.session_id !== data.session_id) {
          // New session detected
          await this._onSessionStart(data);
        } else if (data.stop_audio && !this.audioOptedOut) {
          // Audio stop requested
          await this._onAudioStop();
        }
      } else if (this.session && !this.packaging) {
        // Session ended (active-session.json gone or active=false)
        await this._onSessionEnd();
      }
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        // No active session
        if (this.session && !this.packaging) {
          await this._onSessionEnd();
        }
      }
      // Swallow other errors silently during polling
    }
  }

  async _getActiveSession() {
    const resp = await this.s3.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: 'active-session.json',
    }));
    return JSON.parse(await resp.Body.transformToString());
  }

  async _onSessionStart(data) {
    const sessionId = data.session_id;
    const visitorName = data.visitor_name || 'Unknown';

    console.log(`\n  [session] Session started: ${sessionId} (${visitorName})`);

    this.session = {
      session_id: sessionId,
      visitor_name: visitorName,
      start_time: data.started_at || new Date().toISOString(),
    };
    this.screenshotCount = 0;
    this.audioOptedOut = false;
    this.packaging = false;

    // Create output directories
    const sessionDir = path.join(this.outputDir, sessionId);
    fs.mkdirSync(path.join(sessionDir, 'screenshots'), { recursive: true });

    // Start audio recording
    const audioStarted = await this.audio.start(sessionDir);
    if (!audioStarted) {
      console.log('  [session] Audio recording could not start (no mic or ffmpeg error)');
    }

    this.emit('session-start', this.session);
  }

  async _onAudioStop() {
    console.log('  [session] Audio stop requested by visitor');
    this.audioOptedOut = true;
    await this.audio.stop();
    this.emit('audio-stopped', this.session);
  }

  async _onSessionEnd() {
    if (this.packaging) return;
    this.packaging = true;

    const session = this.session;
    if (!session) { this.packaging = false; return; }

    console.log(`\n  [session] Session ended: ${session.session_id}`);
    this.emit('session-end', session);

    const sessionDir = path.join(this.outputDir, session.session_id);

    try {
      // Stop audio if still running
      const wavPath = await this.audio.stop();

      // Convert WAV to MP3
      if (wavPath && fs.existsSync(wavPath) && !this.audioOptedOut) {
        await this.audio.convertToMp3(wavPath);
      }

      // Package and upload
      const manifest = await packageAndUpload({
        sessionDir,
        sessionId: session.session_id,
        visitorName: session.visitor_name,
        audioOptedOut: this.audioOptedOut,
        bucket: this.bucket,
        region: this.region,
      });

      console.log(`\n  [session] Session ${session.session_id} packaged and uploaded`);
      console.log(`  [session] Screenshots: ${manifest.screenshot_count}, Audio: ${manifest.has_audio}`);
      this.emit('package-complete', manifest);
    } catch (err) {
      console.error(`  [session] Packaging error: ${err.message}`);
      this.emit('package-error', err);
    }

    // Reset
    this.session = null;
    this.screenshotCount = 0;
    this.audioOptedOut = false;
    this.packaging = false;
  }

  addScreenshot(filename, buffer) {
    if (!this.session) return false;
    const dir = path.join(this.outputDir, this.session.session_id, 'screenshots');
    fs.writeFileSync(path.join(dir, filename), buffer);
    this.screenshotCount++;
    return true;
  }

  addClicks(clicksData) {
    if (!this.session) return false;
    const filePath = path.join(this.outputDir, this.session.session_id, 'clicks.json');
    fs.writeFileSync(filePath, typeof clicksData === 'string' ? clicksData : JSON.stringify(clicksData, null, 2));
    return true;
  }

  getStatus() {
    return {
      session_id: this.session?.session_id || null,
      active: !!this.session,
      screenshot_count: this.screenshotCount,
      audio_recording: this.audio.recording,
      audio_opted_out: this.audioOptedOut,
      packaging: this.packaging,
      packager_version: '1.0.0',
    };
  }
}

module.exports = { SessionManager };
