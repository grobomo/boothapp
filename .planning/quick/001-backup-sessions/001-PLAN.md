# Backup Sessions Script

## Goal
Create `scripts/backup-sessions.sh` that downloads all session data from S3 to a local backup directory with compress, verify, restore, and summary features.

## Success Criteria
1. `bash scripts/backup-sessions.sh` syncs from S3 bucket to `./backups/<YYYY-MM-DD>/`
2. `--compress` creates a `.tar.gz` archive of the backup
3. Backup integrity verified by comparing S3 object count to local file count
4. Summary printed: session count, total size, newest/oldest session
5. `--restore <path>` syncs a local backup directory back to S3
6. Follows existing script conventions (set -euo pipefail, color output, env var overrides)
7. Script is executable and passes shellcheck
