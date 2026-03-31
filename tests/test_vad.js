'use strict';

const assert = require('assert');
const { VoiceActivityDetector, computeRms, rmsToDb } = require('../audio/lib/vad');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbToRms(db) {
  return Math.pow(10, db / 20);
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

console.log('-- computeRms --');

(function testRmsSilence() {
  const samples = new Float32Array(128).fill(0);
  assert.strictEqual(computeRms(samples), 0, 'silence -> 0');
  console.log('  PASS: silence');
})();

(function testRmsConstant() {
  const samples = new Float32Array(128).fill(0.5);
  assert.ok(Math.abs(computeRms(samples) - 0.5) < 1e-6, 'constant 0.5 -> 0.5');
  console.log('  PASS: constant signal');
})();

console.log('-- rmsToDb --');

(function testDbSilence() {
  assert.strictEqual(rmsToDb(0), -Infinity, '0 -> -Infinity');
  console.log('  PASS: silence dB');
})();

(function testDbUnity() {
  assert.ok(Math.abs(rmsToDb(1)) < 1e-6, '1 -> 0 dB');
  console.log('  PASS: unity dB');
})();

(function testDbKnown() {
  // 0.1 -> -20 dB
  assert.ok(Math.abs(rmsToDb(0.1) - (-20)) < 0.01, '0.1 -> -20 dB');
  console.log('  PASS: known dB value');
})();

// ---------------------------------------------------------------------------
// VAD event detection
// ---------------------------------------------------------------------------

console.log('-- VAD speech detection --');

(function testSpeechStartEnd() {
  let clock = 0;
  const vad = new VoiceActivityDetector({
    thresholdDb: -40,
    hangoverMs: 100,
    now: () => clock,
  });

  const events = [];
  vad.on('speechStart', e => events.push({ type: 'start', ...e }));
  vad.on('speechEnd', e => events.push({ type: 'end', ...e }));

  // Silence
  clock = 0;
  vad.processFrame(-60);
  clock = 50;
  vad.processFrame(-55);
  assert.strictEqual(vad.isSpeaking, false, 'should be silent');
  assert.strictEqual(events.length, 0, 'no events yet');

  // Speech begins
  clock = 100;
  vad.processFrame(-30);
  assert.strictEqual(vad.isSpeaking, true, 'speaking now');
  assert.strictEqual(events.length, 1, 'speechStart emitted');
  assert.strictEqual(events[0].type, 'start');
  assert.strictEqual(events[0].timestamp, 100);

  // Continue speech
  clock = 150;
  vad.processFrame(-25);
  clock = 200;
  vad.processFrame(-35);

  // Drop below threshold -- hangover starts
  clock = 250;
  vad.processFrame(-50);
  assert.strictEqual(vad.isSpeaking, true, 'hangover keeps speaking');

  // Past hangover
  clock = 450;
  vad.processFrame(-50);
  assert.strictEqual(vad.isSpeaking, false, 'speech ended after hangover');
  assert.strictEqual(events.length, 2, 'speechEnd emitted');
  assert.strictEqual(events[1].type, 'end');
  assert.ok(events[1].segment.duration > 0, 'segment has duration');

  console.log('  PASS: speech start/end with hangover');
})();

// ---------------------------------------------------------------------------
// Duration tracking
// ---------------------------------------------------------------------------

console.log('-- Duration tracking --');

(function testDurations() {
  let clock = 0;
  const vad = new VoiceActivityDetector({
    thresholdDb: -40,
    hangoverMs: 0, // no hangover for simple test
    now: () => clock,
  });

  clock = 0;    vad.processFrame(-60); // init
  clock = 100;  vad.processFrame(-60); // silence: 100ms
  clock = 200;  vad.processFrame(-30); // speech starts
  clock = 300;  vad.processFrame(-30); // speech: 100ms
  clock = 400;  vad.processFrame(-60); // speech ends (hangover=0)
  clock = 500;  vad.processFrame(-60); // silence: 100ms

  assert.strictEqual(vad.totalSpeechMs, 200, 'speech duration');
  assert.strictEqual(vad.totalSilenceMs, 300, 'silence duration');
  assert.ok(Math.abs(vad.talkRatio - 0.4) < 0.01, 'talk ratio ~0.4');

  console.log('  PASS: duration tracking');
})();

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

console.log('-- Segments --');

(function testSegments() {
  let clock = 0;
  const vad = new VoiceActivityDetector({
    thresholdDb: -40,
    hangoverMs: 0,
    now: () => clock,
  });

  // Segment 1
  clock = 0;    vad.processFrame(-60);
  clock = 100;  vad.processFrame(-20); // speech
  clock = 200;  vad.processFrame(-20);
  clock = 300;  vad.processFrame(-60); // end

  // Segment 2
  clock = 500;  vad.processFrame(-10); // speech
  clock = 600;  vad.processFrame(-10);
  clock = 700;  vad.processFrame(-60); // end

  const segs = vad.segments;
  assert.strictEqual(segs.length, 2, 'two segments');
  assert.strictEqual(segs[0].start, 100);
  assert.strictEqual(segs[0].end, 300);
  assert.strictEqual(segs[0].duration, 200);
  assert.strictEqual(segs[1].start, 500);
  assert.strictEqual(segs[1].end, 700);
  assert.strictEqual(segs[1].duration, 200);

  // Defensive copy
  segs.push({ start: 999, end: 999, duration: 0 });
  assert.strictEqual(vad.segments.length, 2, 'original not mutated');

  console.log('  PASS: segment tracking');
})();

// ---------------------------------------------------------------------------
// stop() closes open segment
// ---------------------------------------------------------------------------

console.log('-- stop() --');

(function testStopClosesSegment() {
  let clock = 0;
  const vad = new VoiceActivityDetector({
    thresholdDb: -40,
    hangoverMs: 200,
    now: () => clock,
  });

  const events = [];
  vad.on('speechEnd', e => events.push(e));

  clock = 0;   vad.processFrame(-60);
  clock = 100; vad.processFrame(-20); // speech starts
  clock = 200; vad.processFrame(-20);

  // Stop while speaking
  clock = 300;
  vad.stop();

  assert.strictEqual(vad.isSpeaking, false, 'stopped');
  assert.strictEqual(vad.segments.length, 1, 'segment closed');
  assert.strictEqual(events.length, 1, 'speechEnd emitted on stop');
  assert.strictEqual(events[0].segment.end, 300);

  console.log('  PASS: stop closes open segment');
})();

// ---------------------------------------------------------------------------
// toActivityJson
// ---------------------------------------------------------------------------

console.log('-- toActivityJson --');

(function testActivityJson() {
  let clock = 0;
  const vad = new VoiceActivityDetector({
    thresholdDb: -40,
    hangoverMs: 0,
    now: () => clock,
  });

  clock = 0;    vad.processFrame(-60);
  clock = 100;  vad.processFrame(-20);
  clock = 200;  vad.processFrame(-60);
  clock = 300;  vad.processFrame(-60);

  const json = vad.toActivityJson('sess-001');

  assert.strictEqual(json.sessionId, 'sess-001');
  assert.strictEqual(json.thresholdDb, -40);
  assert.strictEqual(typeof json.capturedAt, 'string');
  assert.strictEqual(json.totalSpeechMs, 100);
  assert.strictEqual(json.totalSilenceMs, 200);
  assert.strictEqual(json.segmentCount, 1);
  assert.ok(json.talkRatio > 0 && json.talkRatio < 1, 'valid ratio');
  assert.ok(Array.isArray(json.segments), 'segments array');

  console.log('  PASS: activity JSON export');
})();

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

console.log('-- reset --');

(function testReset() {
  let clock = 0;
  const vad = new VoiceActivityDetector({ now: () => clock });

  clock = 0;   vad.processFrame(-20);
  clock = 100; vad.processFrame(-20);

  vad.reset();

  assert.strictEqual(vad.totalSpeechMs, 0, 'speech reset');
  assert.strictEqual(vad.totalSilenceMs, 0, 'silence reset');
  assert.strictEqual(vad.segments.length, 0, 'segments reset');
  assert.strictEqual(vad.isSpeaking, false, 'not speaking');

  console.log('  PASS: reset');
})();

// ---------------------------------------------------------------------------
// Event listener management
// ---------------------------------------------------------------------------

console.log('-- off() --');

(function testOff() {
  const vad = new VoiceActivityDetector({ now: () => 0, hangoverMs: 0 });
  let count = 0;
  const fn = () => count++;

  vad.on('speechStart', fn);
  vad.processFrame(-60);
  vad.processFrame(-20); // triggers speechStart
  assert.strictEqual(count, 1);

  vad.off('speechStart', fn);
  vad.processFrame(-60); // end speech
  vad.processFrame(-20); // would trigger again
  assert.strictEqual(count, 1, 'listener removed');

  console.log('  PASS: off() removes listener');
})();

// ---------------------------------------------------------------------------

console.log('\nAll VAD tests passed.');
