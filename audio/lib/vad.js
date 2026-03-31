'use strict';

/**
 * Voice Activity Detection (VAD) module for BoothApp.
 *
 * Uses Web Audio API AnalyserNode to compute RMS energy and detect
 * speech vs silence. Produces speech_activity.json for S3 upload.
 */

const DEFAULT_THRESHOLD_DB = -40;
const DEFAULT_FFT_SIZE = 2048;
const DEFAULT_POLL_INTERVAL_MS = 50;

class VoiceActivityDetector {
  /**
   * @param {Object} opts
   * @param {number} [opts.thresholdDb=-40]       Silence/speech boundary in dB
   * @param {number} [opts.fftSize=2048]          AnalyserNode FFT size
   * @param {number} [opts.pollIntervalMs=50]     How often to sample audio level
   * @param {number} [opts.hangoverMs=200]        Debounce: stay in speech state this long after drop
   * @param {function} [opts.now]                 Clock function (default: Date.now)
   */
  constructor(opts = {}) {
    this.thresholdDb = opts.thresholdDb ?? DEFAULT_THRESHOLD_DB;
    this.fftSize = opts.fftSize ?? DEFAULT_FFT_SIZE;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.hangoverMs = opts.hangoverMs ?? 200;
    this._now = opts.now ?? Date.now;

    this._isSpeaking = false;
    this._speechStartTime = null;
    this._sessionStartTime = null;
    this._totalSpeechMs = 0;
    this._totalSilenceMs = 0;
    this._lastPollTime = null;
    this._segments = [];
    this._listeners = {};
    this._pollTimer = null;
    this._analyser = null;
    this._timeDomainData = null;
  }

  // -- Event emitter (minimal) ------------------------------------------

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return this;
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (!list) return this;
    this._listeners[event] = list.filter(f => f !== fn);
    return this;
  }

  _emit(event, data) {
    const list = this._listeners[event];
    if (list) list.forEach(fn => fn(data));
  }

  // -- Audio wiring -----------------------------------------------------

  /**
   * Connect to a live audio stream.
   * @param {AudioContext} audioContext
   * @param {MediaStream} stream
   */
  connectStream(audioContext, stream) {
    const source = audioContext.createMediaStreamSource(stream);
    this._wireAnalyser(audioContext, source);
  }

  /**
   * Connect to an existing AudioNode (for testing or chaining).
   * @param {AudioContext} audioContext
   * @param {AudioNode} sourceNode
   */
  connectNode(audioContext, sourceNode) {
    this._wireAnalyser(audioContext, sourceNode);
  }

  _wireAnalyser(audioContext, sourceNode) {
    this._analyser = audioContext.createAnalyser();
    this._analyser.fftSize = this.fftSize;
    sourceNode.connect(this._analyser);
    this._timeDomainData = new Float32Array(this._analyser.fftSize);
  }

  // -- Core detection ---------------------------------------------------

  /**
   * Compute RMS energy in dB from the current analyser buffer.
   * @returns {number} dB value (negative; silence ~ -Infinity)
   */
  computeRmsDb() {
    if (!this._analyser) return -Infinity;
    this._analyser.getFloatTimeDomainData(this._timeDomainData);
    return rmsToDb(computeRms(this._timeDomainData));
  }

  /**
   * Process a single audio frame. Call this from your own loop,
   * or use start()/stop() for automatic polling.
   * @param {number} [rmsDb] Optional pre-computed dB; if omitted, reads from analyser.
   */
  processFrame(rmsDb) {
    const now = this._now();
    if (this._sessionStartTime === null) {
      this._sessionStartTime = now;
      this._lastPollTime = now;
    }

    if (rmsDb === undefined) {
      rmsDb = this.computeRmsDb();
    }

    const dt = now - this._lastPollTime;
    const aboveThreshold = rmsDb >= this.thresholdDb;

    if (this._isSpeaking) {
      if (aboveThreshold) {
        this._hangoverDeadline = now + this.hangoverMs;
        this._totalSpeechMs += dt;
      } else if (now >= this._hangoverDeadline) {
        // Speech ended
        this._isSpeaking = false;
        const seg = {
          start: this._speechStartTime,
          end: now,
          duration: now - this._speechStartTime,
        };
        this._segments.push(seg);
        this._totalSilenceMs += dt;
        this._emit('speechEnd', { timestamp: now, segment: seg });
      } else {
        // In hangover period -- still count as speech
        this._totalSpeechMs += dt;
      }
    } else {
      if (aboveThreshold) {
        this._isSpeaking = true;
        this._speechStartTime = now;
        this._hangoverDeadline = now + this.hangoverMs;
        this._totalSpeechMs += dt;
        this._emit('speechStart', { timestamp: now });
      } else {
        this._totalSilenceMs += dt;
      }
    }

    this._lastPollTime = now;
  }

  // -- Auto-polling -----------------------------------------------------

  start() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this.processFrame(), this.pollIntervalMs);
  }

  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    // Close any open speech segment
    if (this._isSpeaking) {
      const now = this._now();
      const seg = {
        start: this._speechStartTime,
        end: now,
        duration: now - this._speechStartTime,
      };
      this._segments.push(seg);
      this._isSpeaking = false;
      this._emit('speechEnd', { timestamp: now, segment: seg });
    }
  }

  // -- Metrics ----------------------------------------------------------

  get isSpeaking() {
    return this._isSpeaking;
  }

  get totalSpeechMs() {
    return this._totalSpeechMs;
  }

  get totalSilenceMs() {
    return this._totalSilenceMs;
  }

  get totalElapsedMs() {
    if (this._sessionStartTime === null) return 0;
    return this._now() - this._sessionStartTime;
  }

  get talkRatio() {
    const total = this._totalSpeechMs + this._totalSilenceMs;
    return total === 0 ? 0 : this._totalSpeechMs / total;
  }

  get segments() {
    return this._segments.slice(); // defensive copy
  }

  // -- Export -----------------------------------------------------------

  /**
   * Produce the speech_activity.json payload for S3.
   * @param {string} sessionId
   * @returns {Object}
   */
  toActivityJson(sessionId) {
    return {
      sessionId,
      capturedAt: new Date().toISOString(),
      thresholdDb: this.thresholdDb,
      totalSpeechMs: this._totalSpeechMs,
      totalSilenceMs: this._totalSilenceMs,
      totalElapsedMs: this.totalElapsedMs,
      talkRatio: Math.round(this.talkRatio * 1000) / 1000,
      segmentCount: this._segments.length,
      segments: this._segments,
    };
  }

  /**
   * Reset all state for a new session.
   */
  reset() {
    this._isSpeaking = false;
    this._speechStartTime = null;
    this._sessionStartTime = null;
    this._totalSpeechMs = 0;
    this._totalSilenceMs = 0;
    this._lastPollTime = null;
    this._segments = [];
  }
}

// -- Pure helpers -------------------------------------------------------

function computeRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

function rmsToDb(rms) {
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

module.exports = { VoiceActivityDetector, computeRms, rmsToDb };
