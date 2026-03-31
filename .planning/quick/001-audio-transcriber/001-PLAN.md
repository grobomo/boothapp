# Enhanced Audio Transcriber

## Goal
Replace the inline Bedrock-based transcription in pipeline.js with a dedicated AWS Transcribe-based transcriber module that supports speaker diarization, streaming, vocabulary hints for Trend Micro products, confidence scores, and enhanced output format.

## Success Criteria
1. `audio/transcriber/transcribe.js` exists with batch transcription using AWS Transcribe
2. Speaker diarization identifies different speakers with labels
3. Real-time streaming transcription option via AWS Transcribe Streaming
4. Custom vocabulary hints for Trend Micro product names (Vision One, XDR, ASRM, ZTA, ZTSA)
5. Confidence scores per segment in output
6. Enhanced transcript.json schema with speaker_label, timestamps, confidence per entry
7. Graceful handling when audio file does not exist
8. Pipeline.js updated to use the new transcriber
9. All existing tests pass
10. New tests cover the transcriber module
