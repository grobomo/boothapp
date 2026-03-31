'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  parseTranscribeOutput,
  transcribe,
  startBatchTranscription,
  TREND_MICRO_VOCABULARY,
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_MAX_SPEAKERS,
} = require('../transcribe');

// ---------------------------------------------------------------------------
// parseTranscribeOutput
// ---------------------------------------------------------------------------

console.log('--- parseTranscribeOutput ---');

// Basic two-speaker conversation
{
  const raw = {
    results: {
      language_code: 'en-US',
      items: [
        { type: 'pronunciation', start_time: '0.0', end_time: '0.5', alternatives: [{ content: 'Hello', confidence: '0.95' }] },
        { type: 'punctuation', alternatives: [{ content: ',' }] },
        { type: 'pronunciation', start_time: '0.6', end_time: '1.2', alternatives: [{ content: 'welcome', confidence: '0.98' }] },
        { type: 'pronunciation', start_time: '1.3', end_time: '1.8', alternatives: [{ content: 'to', confidence: '0.99' }] },
        { type: 'pronunciation', start_time: '1.9', end_time: '2.5', alternatives: [{ content: 'the', confidence: '0.99' }] },
        { type: 'pronunciation', start_time: '2.6', end_time: '3.2', alternatives: [{ content: 'booth', confidence: '0.97' }] },
        { type: 'punctuation', alternatives: [{ content: '.' }] },
        { type: 'pronunciation', start_time: '4.0', end_time: '4.5', alternatives: [{ content: 'Thanks', confidence: '0.92' }] },
        { type: 'punctuation', alternatives: [{ content: '.' }] },
      ],
      speaker_labels: {
        speakers: '2',
        segments: [
          {
            speaker_label: 'spk_0',
            start_time: '0.0',
            end_time: '3.2',
            items: [
              { start_time: '0.0', end_time: '0.5' },
              { start_time: '0.6', end_time: '1.2' },
              { start_time: '1.3', end_time: '1.8' },
              { start_time: '1.9', end_time: '2.5' },
              { start_time: '2.6', end_time: '3.2' },
            ],
          },
          {
            speaker_label: 'spk_1',
            start_time: '4.0',
            end_time: '4.5',
            items: [
              { start_time: '4.0', end_time: '4.5' },
            ],
          },
        ],
      },
    },
  };

  const result = parseTranscribeOutput(raw);

  assert.strictEqual(result.version, '2.0');
  assert.strictEqual(result.metadata.speaker_count, 2);
  assert.strictEqual(result.metadata.language_code, 'en-US');
  assert.strictEqual(result.metadata.transcription_provider, 'aws-transcribe');
  assert.ok(result.metadata.total_duration > 0);

  assert.strictEqual(result.transcript.length, 2);

  assert.strictEqual(result.transcript[0].speaker_label, 'spk_0');
  assert.ok(result.transcript[0].text.includes('Hello'));
  assert.ok(result.transcript[0].text.includes('booth'));
  assert.ok(result.transcript[0].confidence > 0);
  assert.ok(result.transcript[0].confidence <= 1);
  assert.strictEqual(typeof result.transcript[0].start_time, 'number');
  assert.strictEqual(typeof result.transcript[0].end_time, 'number');

  assert.strictEqual(result.transcript[1].speaker_label, 'spk_1');
  assert.ok(result.transcript[1].text.includes('Thanks'));

  assert.ok(result.full_text.includes('[spk_0]'));
  assert.ok(result.full_text.includes('[spk_1]'));

  console.log('  [PASS] two-speaker conversation parsed correctly');
}

// Empty input
{
  const result = parseTranscribeOutput({ results: {} });
  assert.strictEqual(result.version, '2.0');
  assert.strictEqual(result.transcript.length, 0);
  assert.strictEqual(result.full_text, '');
  assert.strictEqual(result.metadata.speaker_count, 0);
  console.log('  [PASS] empty input handled');
}

// Single speaker, no speaker_labels
{
  const raw = {
    results: {
      items: [
        { type: 'pronunciation', start_time: '0.0', end_time: '0.5', alternatives: [{ content: 'Test', confidence: '0.88' }] },
      ],
    },
  };
  const result = parseTranscribeOutput(raw);
  assert.strictEqual(result.transcript.length, 1);
  assert.strictEqual(result.transcript[0].speaker_label, 'spk_0');
  assert.strictEqual(result.transcript[0].confidence, 0.88);
  console.log('  [PASS] fallback speaker label when no diarization');
}

// Confidence averaging across words
{
  const raw = {
    results: {
      items: [
        { type: 'pronunciation', start_time: '0.0', end_time: '0.5', alternatives: [{ content: 'Word1', confidence: '0.80' }] },
        { type: 'pronunciation', start_time: '0.6', end_time: '1.0', alternatives: [{ content: 'Word2', confidence: '0.90' }] },
      ],
      speaker_labels: {
        segments: [
          {
            speaker_label: 'spk_0',
            items: [
              { start_time: '0.0', end_time: '0.5' },
              { start_time: '0.6', end_time: '1.0' },
            ],
          },
        ],
      },
    },
  };
  const result = parseTranscribeOutput(raw);
  assert.strictEqual(result.transcript[0].confidence, 0.85);
  console.log('  [PASS] confidence averaging');
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

console.log('\n--- transcript schema validation ---');

{
  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'transcript-schema.json'), 'utf8'
  ));
  assert.strictEqual(schema.title, 'Enhanced Transcript');
  assert.ok(schema.properties.transcript.items.properties.speaker_label);
  assert.ok(schema.properties.transcript.items.properties.confidence);
  assert.ok(schema.properties.transcript.items.properties.start_time);
  assert.ok(schema.properties.transcript.items.properties.end_time);
  assert.ok(schema.properties.transcript.items.required.includes('speaker_label'));
  assert.ok(schema.properties.transcript.items.required.includes('confidence'));
  console.log('  [PASS] schema has speaker_label, confidence, timestamps');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

console.log('\n--- constants ---');

{
  assert.ok(TREND_MICRO_VOCABULARY.includes('Vision One'));
  assert.ok(TREND_MICRO_VOCABULARY.includes('XDR'));
  assert.ok(TREND_MICRO_VOCABULARY.includes('ASRM'));
  assert.ok(TREND_MICRO_VOCABULARY.includes('ZTA'));
  assert.ok(TREND_MICRO_VOCABULARY.includes('ZTSA'));
  console.log('  [PASS] Trend Micro vocabulary includes all required terms');
}

{
  assert.strictEqual(DEFAULT_LANGUAGE_CODE, 'en-US');
  assert.strictEqual(DEFAULT_MAX_SPEAKERS, 10);
  console.log('  [PASS] default constants');
}

// ---------------------------------------------------------------------------
// Graceful file-not-found handling (async tests wrapped in IIFE)
// ---------------------------------------------------------------------------

(async function runAsyncTests() {
  console.log('\n--- graceful error handling ---');

  // transcribe() with missing local file
  {
    let caught = false;
    try {
      await transcribe({
        audioFilePath: '/tmp/nonexistent-audio-file-12345.webm',
        outputBucket: 'test-bucket',
        mode: 'batch',
      });
    } catch (err) {
      caught = true;
      assert.strictEqual(err.code, 'ENOENT');
      assert.ok(err.message.includes('Audio file not found'));
      assert.ok(err.message.includes('nonexistent-audio-file-12345'));
    }
    assert.ok(caught, 'should throw ENOENT for missing file');
    console.log('  [PASS] batch mode throws ENOENT for missing file');
  }

  // transcribe() streaming with missing local file
  {
    let caught = false;
    try {
      await transcribe({
        audioFilePath: '/tmp/nonexistent-audio-file-99999.webm',
        mode: 'streaming',
      });
    } catch (err) {
      caught = true;
      assert.strictEqual(err.code, 'ENOENT');
    }
    assert.ok(caught, 'should throw ENOENT for missing file in streaming mode');
    console.log('  [PASS] streaming mode throws ENOENT for missing file');
  }

  // startBatchTranscription with missing local file
  {
    let caught = false;
    try {
      await startBatchTranscription({
        audioFilePath: '/tmp/does-not-exist.wav',
        outputBucket: 'test',
      });
    } catch (err) {
      caught = true;
      assert.strictEqual(err.code, 'ENOENT');
      assert.strictEqual(err.path, '/tmp/does-not-exist.wav');
    }
    assert.ok(caught);
    console.log('  [PASS] startBatchTranscription throws ENOENT for missing file');
  }

  // transcribe() with no audioUri and no audioFilePath in batch mode
  {
    let caught = false;
    try {
      await transcribe({
        outputBucket: 'test-bucket',
        mode: 'batch',
      });
    } catch (err) {
      caught = true;
      assert.ok(err.message.includes('audioUri or audioFilePath'));
    }
    assert.ok(caught);
    console.log('  [PASS] batch mode requires audioUri or audioFilePath');
  }

  // transcribe() streaming with no audio source
  {
    let caught = false;
    try {
      await transcribe({ mode: 'streaming' });
    } catch (err) {
      caught = true;
      assert.ok(err.message.includes('audioBuffer or audioFilePath'));
    }
    assert.ok(caught);
    console.log('  [PASS] streaming mode requires audioBuffer or audioFilePath');
  }

  // transcribe() batch without outputBucket
  {
    let caught = false;
    try {
      await transcribe({
        audioUri: 's3://bucket/key',
        mode: 'batch',
      });
    } catch (err) {
      caught = true;
      assert.ok(err.message.includes('outputBucket'));
    }
    assert.ok(caught);
    console.log('  [PASS] batch mode requires outputBucket');
  }

  // ---------------------------------------------------------------------------
  // Output format validation
  // ---------------------------------------------------------------------------

  console.log('\n--- output format ---');

  {
    const raw = {
      results: {
        language_code: 'en-US',
        items: [
          { type: 'pronunciation', start_time: '1.5', end_time: '2.0', alternatives: [{ content: 'Vision', confidence: '0.91' }] },
          { type: 'pronunciation', start_time: '2.1', end_time: '2.5', alternatives: [{ content: 'One', confidence: '0.93' }] },
          { type: 'pronunciation', start_time: '2.6', end_time: '3.0', alternatives: [{ content: 'XDR', confidence: '0.89' }] },
        ],
        speaker_labels: {
          speakers: '1',
          segments: [
            {
              speaker_label: 'spk_0',
              items: [
                { start_time: '1.5', end_time: '2.0' },
                { start_time: '2.1', end_time: '2.5' },
                { start_time: '2.6', end_time: '3.0' },
              ],
            },
          ],
        },
      },
    };

    const result = parseTranscribeOutput(raw);

    for (const entry of result.transcript) {
      assert.ok('speaker_label' in entry, 'missing speaker_label');
      assert.ok('start_time' in entry, 'missing start_time');
      assert.ok('end_time' in entry, 'missing end_time');
      assert.ok('text' in entry, 'missing text');
      assert.ok('confidence' in entry, 'missing confidence');
      assert.strictEqual(typeof entry.speaker_label, 'string');
      assert.strictEqual(typeof entry.start_time, 'number');
      assert.strictEqual(typeof entry.end_time, 'number');
      assert.strictEqual(typeof entry.text, 'string');
      assert.strictEqual(typeof entry.confidence, 'number');
      assert.ok(entry.confidence >= 0 && entry.confidence <= 1);
    }
    console.log('  [PASS] all transcript entries have correct types and ranges');
  }

  console.log('\n=== 14 transcriber tests passed ===');
})().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
