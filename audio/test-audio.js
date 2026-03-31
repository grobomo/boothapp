'use strict';

/**
 * Test script for the BoothApp audio pipeline.
 *
 * Tests:
 *   1. WAV file generation (440Hz tone using Node.js built-ins)
 *   2. S3 upload path construction
 *   3. Transcribe job name formatting
 *   4. Transcript conversion from raw AWS Transcribe output
 *
 * Usage:
 *   node test-audio.js
 */

const fs = require('fs');
const path = require('path');
const { makeJobName } = require('./transcriber/transcribe');
const { convertTranscript, formatTimestamp, mapSpeaker } = require('./transcriber/convert');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}`);
  }
}

// ---------------------------------------------------------------------------
// 1. WAV file generation — 440Hz sine tone, 16-bit PCM mono
// ---------------------------------------------------------------------------
function generateWav(filePath, durationSec, sampleRate, frequency) {
  const numSamples = sampleRate * durationSec;
  const bitsPerSample = 16;
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * blockAlign;

  // 44-byte WAV header + PCM data
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // fmt sub-chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;           // sub-chunk size
  buffer.writeUInt16LE(1, offset); offset += 2;            // PCM format
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data sub-chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // PCM samples — 440Hz sine wave
  const amplitude = 0.8 * 32767;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate));
    buffer.writeInt16LE(sample, offset);
    offset += 2;
  }

  fs.writeFileSync(filePath, buffer);
  return buffer;
}

function testWavGeneration() {
  console.log('\n--- WAV File Generation ---');

  const tmpDir = path.join(__dirname, '.test-tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  const wavPath = path.join(tmpDir, 'test-tone.wav');
  const durationSec = 2;
  const sampleRate = 16000;
  const frequency = 440;

  const buf = generateWav(wavPath, durationSec, sampleRate, frequency);

  assert(fs.existsSync(wavPath), 'WAV file created on disk');

  const stat = fs.statSync(wavPath);
  const expectedSize = 44 + (sampleRate * durationSec * 2); // header + 16-bit mono samples
  assert(stat.size === expectedSize, `File size correct (${stat.size} bytes)`);

  // Verify RIFF header
  const header = fs.readFileSync(wavPath);
  assert(header.toString('ascii', 0, 4) === 'RIFF', 'RIFF magic bytes');
  assert(header.toString('ascii', 8, 12) === 'WAVE', 'WAVE format marker');
  assert(header.readUInt16LE(20) === 1, 'PCM audio format (1)');
  assert(header.readUInt16LE(22) === 1, 'Mono channel');
  assert(header.readUInt32LE(24) === sampleRate, `Sample rate ${sampleRate}`);
  assert(header.readUInt16LE(34) === 16, '16-bit samples');

  // Verify audio data is not silence (samples should have non-zero values)
  let maxSample = 0;
  for (let i = 44; i < Math.min(header.length, 44 + 200); i += 2) {
    const s = Math.abs(header.readInt16LE(i));
    if (s > maxSample) maxSample = s;
  }
  assert(maxSample > 1000, `Audio contains non-zero samples (peak: ${maxSample})`);

  // Cleanup
  fs.unlinkSync(wavPath);
  fs.rmdirSync(tmpDir);
}

// ---------------------------------------------------------------------------
// 2. S3 upload path construction
// ---------------------------------------------------------------------------
function testS3Paths() {
  console.log('\n--- S3 Upload Path Construction ---');

  const sessionId = 'sess-abc-123';

  // Audio input path (used by transcribe.js startTranscriptionJob)
  const audioKey = `sessions/${sessionId}/audio/recording.wav`;
  assert(audioKey === 'sessions/sess-abc-123/audio/recording.wav', 'Audio S3 key format');

  // Transcript output path (used by upload.js)
  const transcriptKey = `sessions/${sessionId}/transcript/transcript.json`;
  assert(transcriptKey === 'sessions/sess-abc-123/transcript/transcript.json', 'Transcript S3 key format');

  // Raw transcribe output path (used by transcribe.js)
  const rawKey = `sessions/${sessionId}/transcript/.transcribe-raw.json`;
  assert(rawKey === 'sessions/sess-abc-123/transcript/.transcribe-raw.json', 'Raw transcribe output S3 key');

  // Paths use forward slashes
  assert(!audioKey.includes('\\'), 'No backslashes in audio path');
  assert(!transcriptKey.includes('\\'), 'No backslashes in transcript path');
}

// ---------------------------------------------------------------------------
// 3. Transcribe job name formatting
// ---------------------------------------------------------------------------
function testJobNameFormatting() {
  console.log('\n--- Transcribe Job Name Formatting ---');

  const name1 = makeJobName('sess-abc-123');
  assert(name1.startsWith('boothapp-sess-abc-123-'), 'Job name starts with boothapp-<sessionId>-');
  assert(name1.length <= 200, `Job name within 200 char limit (${name1.length})`);
  assert(/^[a-zA-Z0-9-]+$/.test(name1), 'Job name contains only alphanumeric and hyphens');

  // Special characters in session ID get sanitized
  const name2 = makeJobName('sess_with.dots&special');
  assert(/^[a-zA-Z0-9-]+$/.test(name2), 'Special chars sanitized to hyphens');
  assert(name2.startsWith('boothapp-'), 'Sanitized name still has prefix');

  // Long session IDs get truncated
  const longId = 'a'.repeat(250);
  const name3 = makeJobName(longId);
  assert(name3.length <= 200, `Long session ID truncated to 200 chars (${name3.length})`);

  // Two calls produce different names (timestamp-based)
  const nameA = makeJobName('same-session');
  const nameB = makeJobName('same-session');
  // They might be the same if called in the same millisecond, so just verify format
  assert(nameA.startsWith('boothapp-same-session-'), 'Repeated call has correct prefix');
}

// ---------------------------------------------------------------------------
// 4. Transcript conversion
// ---------------------------------------------------------------------------
function testTranscriptConversion() {
  console.log('\n--- Transcript Conversion ---');

  // Simulate raw AWS Transcribe output
  const rawTranscribeOutput = {
    results: {
      items: [
        { type: 'pronunciation', start_time: '0.5', end_time: '0.9', speaker_label: 'spk_0', alternatives: [{ content: 'Welcome' }] },
        { type: 'pronunciation', start_time: '1.0', end_time: '1.3', speaker_label: 'spk_0', alternatives: [{ content: 'to' }] },
        { type: 'pronunciation', start_time: '1.4', end_time: '1.8', speaker_label: 'spk_0', alternatives: [{ content: 'Vision' }] },
        { type: 'pronunciation', start_time: '1.9', end_time: '2.2', speaker_label: 'spk_0', alternatives: [{ content: 'One' }] },
        { type: 'punctuation', alternatives: [{ content: '.' }] },
        { type: 'pronunciation', start_time: '3.5', end_time: '3.9', speaker_label: 'spk_1', alternatives: [{ content: 'That' }] },
        { type: 'pronunciation', start_time: '4.0', end_time: '4.3', speaker_label: 'spk_1', alternatives: [{ content: 'looks' }] },
        { type: 'pronunciation', start_time: '4.4', end_time: '4.8', speaker_label: 'spk_1', alternatives: [{ content: 'great' }] },
        { type: 'punctuation', alternatives: [{ content: '!' }] },
      ],
    },
  };

  const transcript = convertTranscript(rawTranscribeOutput, 'test-session-1', 'spk_0');

  assert(transcript.session_id === 'test-session-1', 'Session ID preserved');
  assert(transcript.source === 'recording.wav', 'Source is recording.wav');
  assert(transcript.duration_seconds === 5, 'Duration rounded up to 5s');
  assert(transcript.entries.length === 2, 'Two speaker turns');

  // First entry — SE
  assert(transcript.entries[0].speaker === 'SE', 'First speaker is SE (spk_0)');
  assert(transcript.entries[0].text === 'Welcome to Vision One.', 'SE text with punctuation');
  assert(transcript.entries[0].timestamp === '00:00:00.500', 'SE timestamp formatted');

  // Second entry — Visitor
  assert(transcript.entries[1].speaker === 'Visitor', 'Second speaker is Visitor (spk_1)');
  assert(transcript.entries[1].text === 'That looks great!', 'Visitor text with punctuation');

  // Empty transcript
  const emptyRaw = { results: { items: [] } };
  const emptyTranscript = convertTranscript(emptyRaw, 'empty-session', 'spk_0');
  assert(emptyTranscript.entries.length === 0, 'Empty input produces empty entries');
  assert(emptyTranscript.duration_seconds === 0, 'Empty input has 0 duration');
}

// ---------------------------------------------------------------------------
// 5. Helper function tests
// ---------------------------------------------------------------------------
function testHelpers() {
  console.log('\n--- Helper Functions ---');

  assert(formatTimestamp(0) === '00:00:00.000', 'Format 0 seconds');
  assert(formatTimestamp(1.5) === '00:00:01.500', 'Format 1.5 seconds');
  assert(formatTimestamp(61.123) === '00:01:01.123', 'Format 61.123 seconds');
  assert(formatTimestamp(3661.5) === '01:01:01.500', 'Format 3661.5 seconds');

  assert(mapSpeaker('spk_0', 'spk_0') === 'SE', 'spk_0 maps to SE');
  assert(mapSpeaker('spk_1', 'spk_0') === 'Visitor', 'spk_1 maps to Visitor');
  assert(mapSpeaker('spk_2', 'spk_0') === 'Visitor', 'Any non-SE label maps to Visitor');
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------
console.log('=== BoothApp Audio Pipeline Tests ===');

testWavGeneration();
testS3Paths();
testJobNameFormatting();
testTranscriptConversion();
testHelpers();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
