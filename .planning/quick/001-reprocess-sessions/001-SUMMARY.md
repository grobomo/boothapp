# Batch Analysis Reprocessor - Summary

## What was done
Created `scripts/reprocess-sessions.sh` that scans S3 for sessions needing (re)analysis.

## How it works
1. Lists all session prefixes under `sessions/` in S3
2. Checks each for `metadata.json` (must exist) and `output/summary.json` (must be missing)
3. Deletes `output/.analysis-claimed` and `output/error.json` markers
4. The running watcher picks up unclaimed sessions on its next poll

## Flags
- `--dry-run` -- show what would be reset without changing anything
- `--force` -- also reset sessions that already have summary.json (full re-analysis)
- `--help` -- usage info

## Success criteria met
- [x] Lists sessions with metadata but no summary.json
- [x] Deletes .analysis-claimed marker for each
- [x] --dry-run flag works
- [x] Follows existing script conventions (AWS profile, bucket, region)
- [x] Executable with usage help
