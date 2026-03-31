# Summary: E2E Test at tests/e2e/test-full-pipeline.sh

## What was done
- Created `tests/e2e/test-full-pipeline.sh` per the spec request
- Script exercises the full pipeline: mock S3 session -> watcher detection -> output validation -> cleanup
- Supports `--dry-run`, `--no-cleanup`, and `--timeout=N` flags
- Dry-run verified: 18/18 checks pass (valid JSON, schema compliance, JPEG headers)

## PR
https://github.com/altarr/boothapp/pull/233

## Notes
- An earlier version existed at `scripts/test/test-e2e-pipeline.sh` (PR #180). This version at the requested path adds follow-up.json validation and a configurable `--timeout` flag.
