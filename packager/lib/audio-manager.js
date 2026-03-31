'use strict';
const { spawn, execSync } = require('child_process');
const path = require('path');

// USB/wireless mic keywords for auto-detection scoring
const MIC_KEYWORDS = [
  'usb', 'wireless', 'microphone', 'headset', 'yeti', 'blue',
  'rode', 'shure', 'samson', 'audio-technica', 'fifine', 'hyperx',
];

class AudioManager {
  constructor() {
    this.process = null;
    this.recording = false;
    this.wavPath = null;
    this.device = null;
  }

  detectMic() {
    if (process.env.AUDIO_DEVICE) {
      this.device = process.env.AUDIO_DEVICE;
      console.log(`  [audio] Using override device: ${this.device}`);
      return this.device;
    }

    try {
      const output = execSync(
        'ffmpeg -list_devices true -f dshow -i dummy 2>&1',
        { encoding: 'utf-8', timeout: 10000 }
      ).toString();

      const lines = output.split('\n');
      const audioDevices = [];
      let inAudio = false;

      for (const line of lines) {
        if (line.includes('DirectShow audio devices')) { inAudio = true; continue; }
        if (line.includes('DirectShow video devices')) { inAudio = false; continue; }
        if (!inAudio) continue;

        const match = line.match(/"([^"]+)"/);
        if (match && !line.includes('Alternative name')) {
          const name = match[1];
          const lower = name.toLowerCase();
          const score = MIC_KEYWORDS.reduce((s, kw) => s + (lower.includes(kw) ? 1 : 0), 0);
          audioDevices.push({ name, score });
        }
      }

      audioDevices.sort((a, b) => b.score - a.score);

      if (audioDevices.length > 0) {
        this.device = audioDevices[0].name;
        console.log(`  [audio] Detected mic: ${this.device} (score: ${audioDevices[0].score})`);
        return this.device;
      }
    } catch (_) {}

    console.log('  [audio] No microphone detected');
    return null;
  }

  async start(outputDir) {
    if (this.recording) return true;

    const device = this.detectMic();
    if (!device) return false;

    this.wavPath = path.join(outputDir, 'recording.wav');

    return new Promise((resolve) => {
      const args = [
        '-y', '-f', 'dshow',
        '-i', `audio=${device}`,
        '-ar', '44100', '-ac', '2', '-acodec', 'pcm_s16le',
        this.wavPath,
      ];

      this.process = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

      let started = false;
      const onData = (chunk) => {
        const text = chunk.toString();
        if (!started && (text.includes('Press [q]') || text.includes('size='))) {
          started = true;
          this.recording = true;
          console.log(`  [audio] Recording started → ${this.wavPath}`);
          resolve(true);
        }
      };

      this.process.stderr.on('data', onData);
      this.process.stdout.on('data', onData);

      this.process.on('error', (err) => {
        console.error(`  [audio] ffmpeg error: ${err.message}`);
        this.recording = false;
        if (!started) resolve(false);
      });

      this.process.on('close', () => {
        this.recording = false;
        this.process = null;
      });

      // Timeout: if not started in 10s, give up
      setTimeout(() => { if (!started) { this.kill(); resolve(false); } }, 10000);
    });
  }

  async stop() {
    if (!this.process || !this.recording) return this.wavPath;

    return new Promise((resolve) => {
      // Graceful stop: send 'q' to ffmpeg
      try { this.process.stdin.write('q'); } catch (_) {}

      const timeout = setTimeout(() => {
        console.log('  [audio] Graceful stop timed out, sending SIGTERM');
        this.kill();
        resolve(this.wavPath);
      }, 5000);

      this.process.on('close', () => {
        clearTimeout(timeout);
        this.recording = false;
        console.log('  [audio] Recording stopped');
        resolve(this.wavPath);
      });
    });
  }

  kill() {
    if (this.process) {
      try { this.process.kill('SIGTERM'); } catch (_) {}
      this.process = null;
      this.recording = false;
    }
  }

  async convertToMp3(wavPath) {
    const mp3Path = wavPath.replace(/\.wav$/i, '.mp3');

    return new Promise((resolve, reject) => {
      console.log('  [audio] Converting WAV → MP3 ...');
      const proc = spawn('ffmpeg', [
        '-y', '-i', wavPath,
        '-codec:a', 'libmp3lame', '-qscale:a', '2',
        mp3Path,
      ]);

      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`  [audio] MP3 ready: ${mp3Path}`);
          resolve(mp3Path);
        } else {
          reject(new Error(`ffmpeg MP3 conversion exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }
}

module.exports = { AudioManager };
