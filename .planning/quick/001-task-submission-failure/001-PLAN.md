# Fix: Task Submission Failure (CORS)

## Goal
Fix task/session submission failing on `hackathon.trendcyberrange.com` due to missing CORS origin.

## Root Cause
The CORS allowed origins only include `https://boothapp.trendcyberrange.com` but the app is also
served from `https://hackathon.trendcyberrange.com`. Browser blocks the cross-origin API request,
causing the submission to hang and then error.

## Success Criteria
- [x] `https://hackathon.trendcyberrange.com` added to session orchestrator CORS allowed origins
- [x] `https://hackathon.trendcyberrange.com` added to S3 bucket CORS CloudFormation template
- [x] Existing origins preserved (no regression)
- [x] Tests pass
