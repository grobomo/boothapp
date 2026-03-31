# Analysis Pipeline Error Handling

## Goal
Add robust error handling to the analysis pipeline: retry logic in watcher, stage timeouts in pipeline-run, Bedrock fallback in analyze.py, and an exponential backoff utility.

## Success Criteria
1. watcher.js wraps processing in try/catch, writes error.json to S3, retries up to 2 times
2. pipeline-run.js adds 5-minute timeout per pipeline stage
3. analyze.py handles Bedrock errors with fallback message if Claude fails
4. analysis/lib/retry.js exports exponential backoff utility function
5. All existing tests still pass
6. New tests cover retry, timeout, and fallback behavior
