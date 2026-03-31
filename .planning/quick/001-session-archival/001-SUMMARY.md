# Session Archival - Summary

## What was done

1. **`scripts/archive-sessions.sh`** - Bash script for bulk S3 session archival
   - `--days N` moves sessions older than N days to `archive/` prefix
   - Keeps metadata (metadata.json, badge.json, clicks.json) in active storage
   - Removes large files (screenshots/, audio.webm) from active storage
   - Logs all actions with timestamps to a log file
   - `--delete-old` deletes archived sessions older than 30 days
   - `--dry-run` shows what would happen without making changes

2. **`POST /api/sessions/:id/archive`** - Server endpoint for manual archival
   - Copies all session files to `archive/` prefix
   - Removes large files from active storage
   - Updates metadata.json with `archived`, `archived_at`, `archive_prefix`

3. **Admin panel Archive button** - Per-session archive action
   - Amber "Archive" button on each non-archived session
   - Shows "Archived" badge for already-archived sessions
   - "Archived" option in status filter dropdown

4. **Test** - Added archive endpoint test to existing test suite
