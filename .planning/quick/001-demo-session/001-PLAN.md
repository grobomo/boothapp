# Demo Session Simulator

## Goal
Create `scripts/demo-session.sh` that generates a realistic booth visitor session in S3 for testing the analysis pipeline without manual data entry.

## Success Criteria
1. Script creates a session JSON in `s3://boothapp-sessions-752266476357/`
2. Session contains a randomly selected visitor from 10 fictional attendees
3. Session contains 5-8 click events with real V1 page URLs
4. Session contains a 20-entry transcript simulating an SE demo conversation
5. Session metadata has `status: ended`
6. Uses `AWS_PROFILE=hackathon` and `--region us-east-1`
7. Script is executable and runs without errors
