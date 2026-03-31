# Fix Bedrock Analysis Pipeline

## Goal
Fix analyze.py and the analysis engine so the pipeline works correctly with USE_BEDROCK=1 instead of producing fallback summaries.

## Root Causes Found
1. **MODEL default is wrong for Bedrock**: `ANALYSIS_MODEL` defaults to `claude-sonnet-4-6` which is NOT a valid Bedrock model ID. Bedrock needs `us.anthropic.claude-sonnet-4-6`. When watcher runs with `USE_BEDROCK=1` but no `ANALYSIS_MODEL`, analysis fails with 400 "invalid model identifier".
2. **Retry logic doesn't catch Bedrock errors**: `_is_retryable_api_error()` only checks `anthropic.*` exception types. AnthropicBedrock wraps boto3 errors differently -- botocore `ThrottlingException`, `ServiceUnavailableException`, etc. are not caught, so transient Bedrock errors immediately fail instead of retrying.
3. **Correlator timeline.json unused**: pipeline-run.js step 2 builds a rich timeline with topics, engagement scores, and cross-referenced screenshots, writes it to S3 as `output/timeline.json`. But analyze.py builds its own simpler timeline from raw clicks+transcript, losing all that enrichment.

## Success Criteria
- [ ] `USE_BEDROCK=1` without `ANALYSIS_MODEL` defaults to `us.anthropic.claude-sonnet-4-6`
- [ ] Retry logic handles Bedrock-specific errors (ThrottlingException, etc.)
- [ ] Analyzer loads correlator's timeline.json when available, falls back to building its own
- [ ] `USE_BEDROCK=1 ANALYSIS_MODEL=us.anthropic.claude-sonnet-4-6 python3 analysis/analyze.py --dry-run s3://boothapp-sessions-752266476357/sessions/FULL-775860` succeeds
- [ ] Existing tests still pass
