# Demo Session Simulator - Summary

## What was done
Created `scripts/demo-session.sh` that generates realistic booth visitor sessions in S3.

## Features
- 10 fictional attendees with names, titles, and companies
- 5-8 random click events with real Vision One console page URLs
- 20-entry transcript simulating an SE demo conversation
- Session metadata with `status: ended`, timestamps, duration
- Uploads to `s3://boothapp-sessions-752266476357/` using AWS_PROFILE=hackathon

## Verification
- JSON output validated with python3 json.tool
- Click count assertion: 5-8 range confirmed
- Transcript count assertion: exactly 20 entries confirmed
- metadata.status == "ended" confirmed
