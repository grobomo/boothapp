# Extension Error Recovery

## Goal
Add error recovery to the Chrome extension so failed S3 uploads are queued locally and retried with exponential backoff.

## Success Criteria
1. Failed S3 uploads queue data in chrome.storage.local
2. Retry on next click event with exponential backoff (1s, 2s, 4s, max 30s)
3. Warning icon in popup when uploads are queued
4. Queue cleared on successful upload
5. No data loss -- clicks and screenshots preserved until upload succeeds
