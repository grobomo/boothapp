# Analysis Pipeline Error Handling

## Goal
Add robust error handling to the analysis pipeline: retry logic in watcher, stage timeouts in pipeline, Bedrock fallback in Python analyzer, and a reusable retry utility.

## Success Criteria
1. `analysis/watcher.js` wraps processSession in try/catch that writes error.json to S3 and retries up to 2 times
2. `analysis/pipeline-run.js` exists with 5-minute timeout per pipeline stage
3. `analysis/analyze.py` exists with Bedrock error handling and fallback message if Claude fails
4. `analysis/lib/retry.js` exists with exponential backoff utility function
5. All existing tests still pass
6. New code is committed on a feature branch with a PR to master
