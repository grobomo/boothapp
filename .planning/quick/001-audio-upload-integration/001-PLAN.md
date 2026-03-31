# Audio S3 Upload Integration

## Goal
Integrate s3-upload into recorder.js so recordings are automatically uploaded to S3 after session stop.

## Success Criteria
1. recorder.js calls uploadSessionAudio after recording stops (normal stop and SIGINT/SIGTERM)
2. Upload errors are logged but don't crash the process (best-effort)
3. aud-03-s3-upload task status updated to completed
4. Tests pass (existing test-upload.js)
5. PR created to main
