# Extension Error Recovery -- Summary

## What Was Done
Added retry queue with exponential backoff to the Chrome extension's S3 upload flow.

## Key Decisions
1. **Queue in chrome.storage.local** (not IndexedDB) -- simpler API, sufficient for JSON metadata + base64 screenshots, survives service worker restarts
2. **Drain on click events** -- piggybacks on existing service worker wake pattern instead of adding a new timer
3. **Exponential backoff 1s/2s/4s/.../30s cap** -- prevents hammering a down endpoint while recovering quickly from transient failures
4. **Data preserved in queue before clearing working copies** -- no data loss path exists

## Architecture
- `uploadDirect()` -- pure upload function, no side effects
- `enqueueFailedUpload()` -- snapshots screenshots + clicks into queue
- `processRetryQueue()` -- pops head of queue, retries with backoff
- `get_queue_status` message -- popup polls this to show/hide warning bar

## PR
https://github.com/grobomo/boothapp/pull/96
