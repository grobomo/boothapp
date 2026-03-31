'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// AWS Transcribe-based audio transcriber with speaker diarization,
// streaming support, vocabulary hints, and confidence scores.
// ---------------------------------------------------------------------------

const TREND_MICRO_VOCABULARY = [
  'Vision One',
  'XDR',
  'ASRM',
  'ZTA',
  'ZTSA',
  'Trend Micro',
  'Deep Security',
  'Apex One',
  'Cloud One',
  'Workload Security',
];

const DEFAULT_LANGUAGE_CODE = 'en-US';
const DEFAULT_MAX_SPEAKERS = 10;
const DEFAULT_REGION = 'us-east-1';

/**
 * Build AWS Transcribe client lazily.
 */
function buildTranscribeClient(region) {
  const { TranscribeClient } = require('@aws-sdk/client-transcribe');
  return new TranscribeClient({ region: region || process.env.AWS_REGION || DEFAULT_REGION });
}

/**
 * Build AWS Transcribe Streaming client lazily.
 */
function buildTranscribeStreamingClient(region) {
  const { TranscribeStreamingClient } = require('@aws-sdk/client-transcribe-streaming');
  return new TranscribeStreamingClient({ region: region || process.env.AWS_REGION || DEFAULT_REGION });
}

/**
 * Build S3 client lazily.
 */
function buildS3Client(region) {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({ region: region || process.env.AWS_REGION || DEFAULT_REGION });
}

// ---------------------------------------------------------------------------
// Batch transcription (AWS Transcribe)
// ---------------------------------------------------------------------------

/**
 * Start a batch transcription job with speaker diarization and vocabulary hints.
 *
 * @param {Object} opts
 * @param {string} opts.audioUri        - S3 URI (s3://bucket/key) of audio file
 * @param {string} [opts.audioFilePath] - Local file path (alternative to audioUri)
 * @param {string} opts.outputBucket    - S3 bucket for transcript output
 * @param {string} [opts.jobName]       - Transcription job name (auto-generated if omitted)
 * @param {string} [opts.languageCode]  - Language code (default en-US)
 * @param {number} [opts.maxSpeakers]   - Max speakers for diarization (default 10)
 * @param {string[]} [opts.vocabularyHints] - Custom vocabulary phrases
 * @param {string} [opts.region]        - AWS region
 * @param {Object} [opts.transcribeClient] - Pre-built client (for testing)
 * @param {Object} [opts.s3Client]      - Pre-built S3 client (for testing/upload)
 * @param {Function} [opts.log]         - Logger
 * @returns {Promise<Object>} Transcription job info
 */
async function startBatchTranscription(opts) {
  const {
    audioUri,
    audioFilePath,
    outputBucket,
    jobName,
    languageCode = DEFAULT_LANGUAGE_CODE,
    maxSpeakers = DEFAULT_MAX_SPEAKERS,
    vocabularyHints = TREND_MICRO_VOCABULARY,
    region,
    transcribeClient: clientOverride,
    s3Client: s3Override,
    log = console.log,
  } = opts;

  // Validate: need either audioUri or audioFilePath
  let mediaFileUri = audioUri;

  if (!mediaFileUri && audioFilePath) {
    // Check file exists
    if (!fs.existsSync(audioFilePath)) {
      const err = new Error(`Audio file not found: ${audioFilePath}`);
      err.code = 'ENOENT';
      err.path = audioFilePath;
      throw err;
    }

    // Upload to S3
    const s3 = s3Override || buildS3Client(region);
    const key = `transcribe-input/${path.basename(audioFilePath)}-${Date.now()}`;
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3.send(new PutObjectCommand({
      Bucket: outputBucket,
      Key: key,
      Body: fs.readFileSync(audioFilePath),
    }));
    mediaFileUri = `s3://${outputBucket}/${key}`;
    log(`[transcriber] uploaded local file to ${mediaFileUri}`);
  }

  if (!mediaFileUri) {
    throw new Error('Either audioUri or audioFilePath is required');
  }

  const client = clientOverride || buildTranscribeClient(region);
  const { StartTranscriptionJobCommand } = require('@aws-sdk/client-transcribe');

  const transcriptionJobName = jobName || `boothapp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const params = {
    TranscriptionJobName: transcriptionJobName,
    LanguageCode: languageCode,
    Media: { MediaFileUri: mediaFileUri },
    OutputBucketName: outputBucket,
    Settings: {
      ShowSpeakerLabels: true,
      MaxSpeakerLabels: maxSpeakers,
      ShowAlternatives: false,
    },
  };

  // Add vocabulary hints via VocabularyFilterName or inline phrases
  if (vocabularyHints && vocabularyHints.length > 0) {
    params.Settings.VocabularyFilterMethod = undefined; // not filtering, just boosting
    // Use ModelSettings with custom language model or Content Redaction isn't what we want.
    // AWS Transcribe uses "Custom Vocabulary" for boosting. We create one inline-style
    // by setting LanguageModelName or using Subtitles. For simplicity, we pass hints
    // as a custom vocabulary name if one exists, or document that a vocabulary should
    // be pre-created. For the API, we use the phrases in the job settings.
    //
    // AWS Transcribe requires a pre-created custom vocabulary resource.
    // We support passing a vocabularyName for a pre-created vocabulary.
    if (opts.vocabularyName) {
      params.Settings.VocabularyName = opts.vocabularyName;
    }
  }

  log(`[transcriber] starting batch job="${transcriptionJobName}" uri="${mediaFileUri}" speakers=${maxSpeakers}`);

  const resp = await client.send(new StartTranscriptionJobCommand(params));
  return {
    jobName: transcriptionJobName,
    status: resp.TranscriptionJob.TranscriptionJobStatus,
    mediaUri: mediaFileUri,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Poll for batch transcription job completion.
 *
 * @param {Object} opts
 * @param {string} opts.jobName
 * @param {number} [opts.pollIntervalMs] - default 5000
 * @param {number} [opts.timeoutMs]      - default 300000 (5 min)
 * @param {string} [opts.region]
 * @param {Object} [opts.transcribeClient]
 * @param {Function} [opts.log]
 * @returns {Promise<Object>} Completed job details with transcript URI
 */
async function waitForTranscription(opts) {
  const {
    jobName,
    pollIntervalMs = 5000,
    timeoutMs = 300000,
    region,
    transcribeClient: clientOverride,
    log = console.log,
  } = opts;

  const client = clientOverride || buildTranscribeClient(region);
  const { GetTranscriptionJobCommand } = require('@aws-sdk/client-transcribe');

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const resp = await client.send(new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName,
    }));

    const job = resp.TranscriptionJob;
    const status = job.TranscriptionJobStatus;

    if (status === 'COMPLETED') {
      log(`[transcriber] job="${jobName}" completed`);
      return {
        jobName,
        status: 'COMPLETED',
        transcriptUri: job.Transcript.TranscriptFileUri,
        completedAt: new Date().toISOString(),
      };
    }

    if (status === 'FAILED') {
      const err = new Error(`Transcription job failed: ${job.FailureReason || 'unknown'}`);
      err.code = 'TranscriptionJobFailed';
      err.jobName = jobName;
      throw err;
    }

    log(`[transcriber] job="${jobName}" status=${status}, waiting ${pollIntervalMs}ms...`);
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  const err = new Error(`Transcription job "${jobName}" timed out after ${timeoutMs}ms`);
  err.code = 'TranscriptionTimeout';
  err.jobName = jobName;
  throw err;
}

/**
 * Fetch and parse the AWS Transcribe JSON output into our enhanced format.
 *
 * @param {Object} opts
 * @param {string} opts.transcriptUri - HTTPS URI from completed job
 * @param {Object} [opts.s3Client]
 * @param {string} [opts.region]
 * @returns {Promise<Object>} Enhanced transcript
 */
async function fetchTranscriptResult(opts) {
  const { transcriptUri, s3Client: s3Override, region } = opts;

  // Parse S3 URI from the HTTPS transcript URI
  // Format: https://s3.<region>.amazonaws.com/<bucket>/<key>
  const url = new URL(transcriptUri);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const bucket = pathParts[0];
  const key = pathParts.slice(1).join('/');

  const s3 = s3Override || buildS3Client(region);
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

  const chunks = [];
  for await (const chunk of resp.Body) {
    chunks.push(chunk);
  }
  const raw = JSON.parse(Buffer.concat(chunks).toString());
  return parseTranscribeOutput(raw);
}

/**
 * Parse raw AWS Transcribe JSON into our enhanced transcript format.
 *
 * @param {Object} raw - Raw AWS Transcribe output JSON
 * @returns {Object} Enhanced transcript with speaker labels, timestamps, confidence
 */
function parseTranscribeOutput(raw) {
  const results = raw.results || {};
  const items = results.items || [];
  const speakerLabels = results.speaker_labels || {};
  const segments = speakerLabels.segments || [];

  // Build a map of item index -> speaker label from speaker_labels segments
  const speakerMap = new Map();
  for (const segment of segments) {
    const speaker = segment.speaker_label;
    for (const item of (segment.items || [])) {
      const key = `${item.start_time}-${item.end_time}`;
      speakerMap.set(key, speaker);
    }
  }

  // Build enhanced transcript entries
  const entries = [];
  let currentSpeaker = null;
  let currentEntry = null;

  for (const item of items) {
    if (item.type === 'punctuation') {
      // Append punctuation to current entry
      if (currentEntry) {
        currentEntry.text += item.alternatives[0].content;
      }
      continue;
    }

    const startTime = parseFloat(item.start_time);
    const endTime = parseFloat(item.end_time);
    const alt = item.alternatives[0] || {};
    const confidence = parseFloat(alt.confidence) || 0;
    const content = alt.content || '';
    const timeKey = `${item.start_time}-${item.end_time}`;
    const speaker = speakerMap.get(timeKey) || currentSpeaker || 'spk_0';

    if (speaker !== currentSpeaker || !currentEntry) {
      // New speaker segment
      if (currentEntry) {
        currentEntry.end_time = entries.length > 0
          ? parseFloat(items.find((i) => i.type !== 'punctuation' && i.start_time)?.end_time || currentEntry.end_time)
          : currentEntry.end_time;
        entries.push(currentEntry);
      }
      currentSpeaker = speaker;
      currentEntry = {
        speaker_label: speaker,
        start_time: startTime,
        end_time: endTime,
        text: content,
        confidence: confidence,
        word_count: 1,
        confidence_sum: confidence,
      };
    } else {
      // Same speaker, extend segment
      currentEntry.text += ' ' + content;
      currentEntry.end_time = endTime;
      currentEntry.word_count += 1;
      currentEntry.confidence_sum += confidence;
    }
  }

  // Push last entry
  if (currentEntry) {
    entries.push(currentEntry);
  }

  // Calculate average confidence per segment
  const transcript = entries.map((e) => ({
    speaker_label: e.speaker_label,
    start_time: e.start_time,
    end_time: e.end_time,
    text: e.text,
    confidence: e.word_count > 0
      ? Math.round((e.confidence_sum / e.word_count) * 1000) / 1000
      : 0,
  }));

  // Full text
  const fullText = transcript.map((e) => `[${e.speaker_label}] ${e.text}`).join('\n');

  return {
    version: '2.0',
    metadata: {
      speaker_count: speakerLabels.speakers
        ? parseInt(speakerLabels.speakers, 10)
        : new Set(transcript.map((e) => e.speaker_label)).size,
      total_duration: transcript.length > 0
        ? transcript[transcript.length - 1].end_time
        : 0,
      language_code: raw.results?.language_code || DEFAULT_LANGUAGE_CODE,
      transcription_provider: 'aws-transcribe',
    },
    transcript,
    full_text: fullText,
  };
}

// ---------------------------------------------------------------------------
// Real-time streaming transcription (AWS Transcribe Streaming)
// ---------------------------------------------------------------------------

/**
 * Start a real-time streaming transcription session.
 *
 * @param {Object} opts
 * @param {ReadableStream|Buffer} opts.audioStream - Audio data stream or buffer
 * @param {string} [opts.languageCode]
 * @param {number} [opts.sampleRate]   - Audio sample rate in Hz (default 16000)
 * @param {string} [opts.mediaEncoding] - 'pcm', 'ogg-opus', or 'flac' (default pcm)
 * @param {boolean} [opts.enableSpeakerDiarization] - default true
 * @param {number} [opts.maxSpeakers]
 * @param {string} [opts.vocabularyName] - Pre-created custom vocabulary name
 * @param {string} [opts.region]
 * @param {Object} [opts.streamingClient]
 * @param {Function} [opts.onSegment]  - Callback for each transcript segment
 * @param {Function} [opts.log]
 * @returns {Promise<Object>} Final enhanced transcript
 */
async function startStreamingTranscription(opts) {
  const {
    audioStream,
    languageCode = DEFAULT_LANGUAGE_CODE,
    sampleRate = 16000,
    mediaEncoding = 'pcm',
    enableSpeakerDiarization = true,
    maxSpeakers = DEFAULT_MAX_SPEAKERS,
    vocabularyName,
    region,
    streamingClient: clientOverride,
    onSegment = () => {},
    log = console.log,
  } = opts;

  if (!audioStream) {
    throw new Error('audioStream is required for streaming transcription');
  }

  const client = clientOverride || buildTranscribeStreamingClient(region);
  const { StartStreamTranscriptionCommand } = require('@aws-sdk/client-transcribe-streaming');

  const params = {
    LanguageCode: languageCode,
    MediaSampleRateHertz: sampleRate,
    MediaEncoding: mediaEncoding,
    AudioStream: audioStreamGenerator(audioStream),
    EnableChannelIdentification: false,
    ShowSpeakerLabel: enableSpeakerDiarization,
    NumberOfChannels: 1,
  };

  if (vocabularyName) {
    params.VocabularyName = vocabularyName;
  }

  log(`[transcriber] starting streaming transcription lang=${languageCode} rate=${sampleRate}`);

  const resp = await client.send(new StartStreamTranscriptionCommand(params));

  const entries = [];
  let currentSpeaker = null;
  let currentEntry = null;

  for await (const event of resp.TranscriptResultStream) {
    if (event.TranscriptEvent) {
      const results = event.TranscriptEvent.Transcript.Results || [];

      for (const result of results) {
        if (result.IsPartial) continue; // Only process final results

        for (const alt of (result.Alternatives || [])) {
          const altItems = alt.Items || [];

          for (const item of altItems) {
            if (item.Type === 'punctuation') {
              if (currentEntry) {
                currentEntry.text += item.Content;
              }
              continue;
            }

            const speaker = item.Speaker || currentSpeaker || 'spk_0';
            const confidence = item.Confidence || 0;
            const startTime = item.StartTime || 0;
            const endTime = item.EndTime || 0;

            if (speaker !== currentSpeaker || !currentEntry) {
              if (currentEntry) {
                entries.push(finalizeEntry(currentEntry));
                onSegment(entries[entries.length - 1]);
              }
              currentSpeaker = speaker;
              currentEntry = {
                speaker_label: `spk_${speaker}`,
                start_time: startTime,
                end_time: endTime,
                text: item.Content || '',
                confidence_sum: confidence,
                word_count: 1,
              };
            } else {
              currentEntry.text += ' ' + (item.Content || '');
              currentEntry.end_time = endTime;
              currentEntry.confidence_sum += confidence;
              currentEntry.word_count += 1;
            }
          }
        }
      }
    }
  }

  if (currentEntry) {
    entries.push(finalizeEntry(currentEntry));
    onSegment(entries[entries.length - 1]);
  }

  const fullText = entries.map((e) => `[${e.speaker_label}] ${e.text}`).join('\n');

  log(`[transcriber] streaming complete, ${entries.length} segments`);

  return {
    version: '2.0',
    metadata: {
      speaker_count: new Set(entries.map((e) => e.speaker_label)).size,
      total_duration: entries.length > 0 ? entries[entries.length - 1].end_time : 0,
      language_code: languageCode,
      transcription_provider: 'aws-transcribe-streaming',
    },
    transcript: entries,
    full_text: fullText,
  };
}

function finalizeEntry(entry) {
  return {
    speaker_label: entry.speaker_label,
    start_time: entry.start_time,
    end_time: entry.end_time,
    text: entry.text,
    confidence: entry.word_count > 0
      ? Math.round((entry.confidence_sum / entry.word_count) * 1000) / 1000
      : 0,
  };
}

/**
 * Generator that yields audio chunks for the streaming API.
 */
async function* audioStreamGenerator(input) {
  if (Buffer.isBuffer(input)) {
    // Split buffer into chunks (~8KB each for streaming)
    const chunkSize = 8192;
    for (let i = 0; i < input.length; i += chunkSize) {
      yield { AudioEvent: { AudioChunk: input.slice(i, i + chunkSize) } };
    }
  } else if (input && typeof input[Symbol.asyncIterator] === 'function') {
    for await (const chunk of input) {
      yield { AudioEvent: { AudioChunk: chunk } };
    }
  } else if (input && typeof input.on === 'function') {
    // Node.js readable stream
    for await (const chunk of input) {
      yield { AudioEvent: { AudioChunk: chunk } };
    }
  } else {
    throw new Error('audioStream must be a Buffer, async iterable, or readable stream');
  }
}

// ---------------------------------------------------------------------------
// High-level transcribe function (used by pipeline)
// ---------------------------------------------------------------------------

/**
 * Transcribe an audio file, choosing batch or streaming mode.
 *
 * @param {Object} opts
 * @param {string} [opts.audioFilePath]  - Local path to audio file
 * @param {string} [opts.audioUri]       - S3 URI of audio file
 * @param {Buffer} [opts.audioBuffer]    - Raw audio buffer (for streaming)
 * @param {string} opts.outputBucket     - S3 bucket for output
 * @param {string} [opts.mode]           - 'batch' or 'streaming' (default batch)
 * @param {Object} [opts.clients]        - { transcribeClient, s3Client, streamingClient }
 * @param {Function} [opts.log]
 * @returns {Promise<Object>} Enhanced transcript
 */
async function transcribe(opts) {
  const {
    audioFilePath,
    audioUri,
    audioBuffer,
    outputBucket,
    mode = 'batch',
    clients = {},
    log = console.log,
  } = opts;

  // Graceful handling: check if local file exists
  if (audioFilePath && !fs.existsSync(audioFilePath)) {
    const err = new Error(`Audio file not found: ${audioFilePath}`);
    err.code = 'ENOENT';
    err.path = audioFilePath;
    throw err;
  }

  if (mode === 'streaming') {
    const stream = audioBuffer || (audioFilePath ? fs.createReadStream(audioFilePath) : null);
    if (!stream) {
      throw new Error('Streaming mode requires audioBuffer or audioFilePath');
    }
    return startStreamingTranscription({
      audioStream: stream,
      streamingClient: clients.streamingClient,
      vocabularyName: opts.vocabularyName,
      log,
    });
  }

  // Batch mode
  if (!outputBucket) {
    throw new Error('outputBucket is required for batch transcription');
  }

  const jobInfo = await startBatchTranscription({
    audioFilePath,
    audioUri,
    outputBucket,
    vocabularyName: opts.vocabularyName,
    transcribeClient: clients.transcribeClient,
    s3Client: clients.s3Client,
    log,
  });

  const completed = await waitForTranscription({
    jobName: jobInfo.jobName,
    transcribeClient: clients.transcribeClient,
    log,
  });

  return fetchTranscriptResult({
    transcriptUri: completed.transcriptUri,
    s3Client: clients.s3Client,
  });
}

// ---------------------------------------------------------------------------
// Vocabulary helper
// ---------------------------------------------------------------------------

/**
 * Create a custom vocabulary in AWS Transcribe for Trend Micro terms.
 *
 * @param {Object} opts
 * @param {string} opts.vocabularyName
 * @param {string[]} [opts.phrases]
 * @param {string} [opts.languageCode]
 * @param {string} [opts.region]
 * @param {Object} [opts.transcribeClient]
 * @returns {Promise<Object>}
 */
async function createCustomVocabulary(opts) {
  const {
    vocabularyName,
    phrases = TREND_MICRO_VOCABULARY,
    languageCode = DEFAULT_LANGUAGE_CODE,
    region,
    transcribeClient: clientOverride,
  } = opts;

  const client = clientOverride || buildTranscribeClient(region);
  const { CreateVocabularyCommand } = require('@aws-sdk/client-transcribe');

  const resp = await client.send(new CreateVocabularyCommand({
    VocabularyName: vocabularyName,
    LanguageCode: languageCode,
    Phrases: phrases,
  }));

  return {
    vocabularyName,
    status: resp.VocabularyState,
    languageCode,
  };
}

module.exports = {
  transcribe,
  startBatchTranscription,
  waitForTranscription,
  fetchTranscriptResult,
  parseTranscribeOutput,
  startStreamingTranscription,
  createCustomVocabulary,
  audioStreamGenerator,
  TREND_MICRO_VOCABULARY,
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_MAX_SPEAKERS,
};
