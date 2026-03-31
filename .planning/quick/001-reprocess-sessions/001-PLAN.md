# Batch Analysis Reprocessor

## Goal
Create `scripts/reprocess-sessions.sh` that finds S3 sessions with metadata but no output/summary.json and re-triggers analysis by deleting the `.analysis-claimed` marker. Supports `--dry-run`.

## Success Criteria
1. Script lists all sessions in S3 that have `metadata.json` but no `output/summary.json`
2. For each such session, deletes `output/.analysis-claimed` marker from S3
3. `--dry-run` flag shows what would happen without making changes
4. Follows existing script conventions (AWS profile, bucket, region from config)
5. Script is executable and has usage help
