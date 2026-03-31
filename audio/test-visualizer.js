#!/usr/bin/env node
'use strict';

/**
 * test-visualizer.js — Unit tests for AudioVisualizer
 *
 * Tests the RMS computation, peak tracking, and silence detection
 * without needing ffmpeg or a real audio device.
 */

const { AudioVisualizer } = require('./lib/visualizer');
const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

// Helper: create a 100ms frame of 16-bit signed LE samples at 8kHz mono
// 8000 samples/s / 10 = 800 samples per 100ms tick, 2 bytes each = 1600 bytes
const SAMPLES_PER_TICK = 800;
const BYTES_PER_TICK = SAMPLES_PER_TICK * 2;

function makeFrame(sampleValue) {
  const buf = Buffer.alloc(BYTES_PER_TICK);
  for (let i = 0; i < SAMPLES_PER_TICK; i++) {
    buf.writeInt16LE(sampleValue, i * 2);
  }
  return buf;
}

function makeSineFrame(amplitude) {
  const buf = Buffer.alloc(BYTES_PER_TICK);
  for (let i = 0; i < SAMPLES_PER_TICK; i++) {
    const val = Math.round(amplitude * Math.sin(2 * Math.PI * 440 * i / 8000));
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, val)), i * 2);
  }
  return buf;
}

console.log('AudioVisualizer tests\n');

// -- Constructor tests --

test('constructor requires device option', () => {
  assert.throws(() => new AudioVisualizer({}), /device is required/);
  assert.throws(() => new AudioVisualizer(), /device is required/);
});

test('constructor accepts valid options', () => {
  const viz = new AudioVisualizer({ device: 'TestMic' });
  assert.strictEqual(viz.getLevel(), 0);
  assert.strictEqual(viz.getPeak(), 0);
});

// -- RMS computation tests (via _processFrame) --

test('silent frame produces level 0', () => {
  const viz = new AudioVisualizer({ device: 'TestMic' });
  viz._processFrame(makeFrame(0));
  assert.strictEqual(viz.getLevel(), 0);
});

test('max amplitude frame produces level 100', () => {
  const viz = new AudioVisualizer({ device: 'TestMic' });
  viz._processFrame(makeFrame(32767));
  assert.strictEqual(viz.getLevel(), 100);
});

test('negative max amplitude frame produces level 100', () => {
  const viz = new AudioVisualizer({ device: 'TestMic' });
  viz._processFrame(makeFrame(-32768));
  assert.strictEqual(viz.getLevel(), 100);
});

test('mid-level sine wave produces reasonable level', () => {
  const viz = new AudioVisualizer({ device: 'TestMic' });
  // ~50% amplitude sine wave RMS = amplitude / sqrt(2) ~ 0.707 * 0.5 = 0.354 -> level ~35
  viz._processFrame(makeSineFrame(16384));
  const level = viz.getLevel();
  assert.ok(level > 20 && level < 60, `expected 20-60, got ${level}`);
});

// -- Peak tracking --

test('peak tracks highest level seen', () => {
  const viz = new AudioVisualizer({ device: 'TestMic' });
  viz._processFrame(makeSineFrame(8000));
  const first = viz.getLevel();
  viz._processFrame(makeSineFrame(32000));
  const second = viz.getLevel();
  viz._processFrame(makeSineFrame(8000));
  assert.strictEqual(viz.getPeak(), second);
  assert.ok(viz.getPeak() > first, 'peak should be higher than first level');
});

// -- _onData buffering --

test('_onData buffers partial frames correctly', () => {
  const viz = new AudioVisualizer({ device: 'TestMic' });
  const frame = makeFrame(16384);
  // Send in two halves
  viz._onData(frame.slice(0, BYTES_PER_TICK / 2));
  assert.strictEqual(viz.getLevel(), 0); // not enough data yet
  viz._onData(frame.slice(BYTES_PER_TICK / 2));
  assert.ok(viz.getLevel() > 0, 'should have processed frame after second chunk');
});

test('_onData handles multiple frames in one chunk', () => {
  const viz = new AudioVisualizer({ device: 'TestMic' });
  const twoFrames = Buffer.concat([makeFrame(16384), makeFrame(32767)]);
  let levelCount = 0;
  viz.on('level', () => levelCount++);
  viz._onData(twoFrames);
  assert.strictEqual(levelCount, 2, 'should emit level twice for two frames');
});

// -- Silence detection --

test('silence detection warns after timeout', () => {
  const viz = new AudioVisualizer({
    device: 'TestMic',
    silenceThreshold: 5,
    silenceTimeoutMs: 200, // short timeout for testing
  });

  let warned = false;
  viz.on('silence-warning', () => { warned = true; });

  // Simulate silence start time in the past
  viz._silenceStart = Date.now() - 300;
  viz._processFrame(makeFrame(0)); // silent frame

  assert.ok(warned, 'should have emitted silence-warning');
});

test('silence detection resets when audio detected', () => {
  const viz = new AudioVisualizer({
    device: 'TestMic',
    silenceThreshold: 5,
    silenceTimeoutMs: 200,
  });

  let warnCount = 0;
  viz.on('silence-warning', () => { warnCount++; });

  // Fake old silence start
  viz._silenceStart = Date.now() - 300;
  viz._processFrame(makeFrame(32767)); // loud frame resets silence
  assert.strictEqual(warnCount, 0, 'should not warn after loud frame');

  // Now silence again but fresh timer
  viz._processFrame(makeFrame(0));
  assert.strictEqual(warnCount, 0, 'should not warn immediately after reset');
});

test('silence warning only fires once per silence period', () => {
  const viz = new AudioVisualizer({
    device: 'TestMic',
    silenceThreshold: 5,
    silenceTimeoutMs: 100,
  });

  let warnCount = 0;
  viz.on('silence-warning', () => { warnCount++; });

  viz._silenceStart = Date.now() - 200;
  viz._processFrame(makeFrame(0));
  viz._processFrame(makeFrame(0));
  viz._processFrame(makeFrame(0));
  assert.strictEqual(warnCount, 1, 'should only warn once');
});

// -- level event --

test('emits level event on each frame', () => {
  const viz = new AudioVisualizer({ device: 'TestMic' });
  const levels = [];
  viz.on('level', (l) => levels.push(l));
  viz._processFrame(makeSineFrame(10000));
  viz._processFrame(makeSineFrame(20000));
  assert.strictEqual(levels.length, 2);
  assert.ok(levels[1] > levels[0], 'second level should be higher');
});

// -- Summary --
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
