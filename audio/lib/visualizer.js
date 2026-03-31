'use strict';

/**
 * visualizer.js — Audio level meter and silence detector
 *
 * Connects to an audio device via ffmpeg, computes RMS levels at 10Hz,
 * and exposes a simple polling API for the Chrome extension popup.
 *
 * Usage:
 *   const { AudioVisualizer } = require('./lib/visualizer');
 *   const viz = new AudioVisualizer({ device: 'Microphone (USB)' });
 *   viz.start();
 *   // poll from extension:
 *   viz.getLevel();  // 0-100
 *   viz.getPeak();   // 0-100 (session max)
 *   viz.stop();
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');

// Analysis sample rate — low is fine for level metering
const ANALYSIS_SAMPLE_RATE = 8000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2; // 16-bit signed LE
// Samples needed per 100ms update at 8kHz mono
const SAMPLES_PER_TICK = (ANALYSIS_SAMPLE_RATE * CHANNELS) / 10;
const BYTES_PER_TICK = SAMPLES_PER_TICK * BYTES_PER_SAMPLE;

const SILENCE_THRESHOLD = 3;       // level 0-100; below this = silence
const SILENCE_TIMEOUT_MS = 30000;  // 30 seconds of silence triggers warning

class AudioVisualizer extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.device - audio device name (dshow format)
   * @param {number} [options.silenceThreshold=3] - level below which audio counts as silent (0-100)
   * @param {number} [options.silenceTimeoutMs=30000] - ms of silence before warning
   */
  constructor(options) {
    super();
    if (!options || !options.device) throw new Error('options.device is required');

    this.device = options.device;
    this.silenceThreshold = options.silenceThreshold != null ? options.silenceThreshold : SILENCE_THRESHOLD;
    this.silenceTimeoutMs = options.silenceTimeoutMs != null ? options.silenceTimeoutMs : SILENCE_TIMEOUT_MS;

    this._level = 0;
    this._peak = 0;
    this._proc = null;
    this._buf = Buffer.alloc(0);
    this._silenceStart = null;
    this._silenceWarned = false;
    this._running = false;
  }

  /**
   * Current audio level (0-100). Poll this at any rate.
   * @returns {number}
   */
  getLevel() {
    return this._level;
  }

  /**
   * Peak audio level seen this session (0-100).
   * @returns {number}
   */
  getPeak() {
    return this._peak;
  }

  /**
   * Start the level meter. Spawns a lightweight ffmpeg reading raw PCM.
   */
  start() {
    if (this._running) return;
    this._running = true;
    this._silenceStart = Date.now();
    this._silenceWarned = false;

    const args = [
      '-f', 'dshow',
      '-i', `audio=${this.device}`,
      '-ar', String(ANALYSIS_SAMPLE_RATE),
      '-ac', String(CHANNELS),
      '-f', 's16le',    // raw 16-bit signed LE PCM to stdout
      '-v', 'quiet',
      'pipe:1',
    ];

    this._proc = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._proc.stdout.on('data', (chunk) => {
      this._onData(chunk);
    });

    this._proc.on('error', (err) => {
      this.emit('error', err);
    });

    this._proc.on('close', (code) => {
      this._running = false;
      this.emit('stopped', { code });
    });

    this.emit('started');
  }

  /**
   * Stop the level meter.
   */
  stop() {
    if (!this._proc || !this._running) return;
    this._running = false;
    try {
      this._proc.stdin.write('q\n');
      this._proc.stdin.end();
    } catch (_) {
      // stdin may be closed
    }
    setTimeout(() => {
      if (this._proc) {
        try { this._proc.kill('SIGTERM'); } catch (_) { /* noop */ }
      }
    }, 2000);
  }

  /**
   * Process incoming raw PCM data. Computes RMS over 100ms windows.
   * @param {Buffer} chunk
   */
  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);

    while (this._buf.length >= BYTES_PER_TICK) {
      const frame = this._buf.slice(0, BYTES_PER_TICK);
      this._buf = this._buf.slice(BYTES_PER_TICK);
      this._processFrame(frame);
    }
  }

  /**
   * Compute RMS for one 100ms frame of 16-bit signed LE samples.
   * @param {Buffer} frame
   */
  _processFrame(frame) {
    const sampleCount = frame.length / BYTES_PER_SAMPLE;
    let sumSquares = 0;

    for (let i = 0; i < sampleCount; i++) {
      const sample = frame.readInt16LE(i * BYTES_PER_SAMPLE);
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / sampleCount);
    // Normalize: max 16-bit value is 32767, map to 0-100
    const level = Math.min(100, Math.round((rms / 32767) * 100));

    this._level = level;
    if (level > this._peak) {
      this._peak = level;
    }

    this._checkSilence(level);
    this.emit('level', level);
  }

  /**
   * Track silence duration. Logs warning if below threshold for silenceTimeoutMs.
   * @param {number} level
   */
  _checkSilence(level) {
    const now = Date.now();

    if (level >= this.silenceThreshold) {
      // Audio detected — reset silence tracker
      this._silenceStart = now;
      this._silenceWarned = false;
      return;
    }

    // Level is below threshold
    if (this._silenceStart === null) {
      this._silenceStart = now;
    }

    const silenceDuration = now - this._silenceStart;
    if (silenceDuration >= this.silenceTimeoutMs && !this._silenceWarned) {
      this._silenceWarned = true;
      const msg = `[WARN] Audio silence detected for ${Math.round(silenceDuration / 1000)}s — possible dead mic`;
      console.warn(`[${new Date().toISOString()}] ${msg}`);
      this.emit('silence-warning', { durationMs: silenceDuration, device: this.device });
    }
  }
}

module.exports = { AudioVisualizer };
