# Session Archival and Cleanup

## Goal
Add session archival and cleanup capabilities to BoothApp: a shell script for bulk S3 archival and an admin panel button for manual single-session archival.

## Success Criteria
1. `scripts/archive-sessions.sh` moves sessions older than N days from `sessions/` to `archive/` prefix in S3
2. Script keeps metadata but removes large files (screenshots, audio) from active storage
3. Script logs what was archived with timestamps
4. `--delete-old` flag deletes archived sessions older than 30 days
5. `--dry-run` flag shows what would be archived without doing it
6. Admin panel has "Archive" button per session for manual archival
7. Server.js has POST /api/sessions/:id/archive endpoint
