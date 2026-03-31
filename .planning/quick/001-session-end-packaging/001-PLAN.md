# Session End & Packaging (Feature 7)

## Goal
Implement the CaseyApp packager service (Node.js on port 9222) for Feature 7 of Casey's Feature Document.

## Success Criteria
1. POST /clicks receives clicks.json from extension on session end
2. POST /session/end triggers packaging pipeline
3. Audio recording stops on session end
4. WAV converted to MP3 via ffmpeg (libmp3lame VBR quality 2)
5. Zip named Visitor_Name_SessionID containing screenshots/, audio/, clicks/
6. Zip uploaded to S3
7. package-manifest.json written to S3
8. Unit tests validate all components
