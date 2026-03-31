#!/usr/bin/env bash
# backup-sessions.sh -- Download all session data from S3 to a local backup.
# Usage: bash scripts/backup-sessions.sh [--compress] [--restore <backup-path>]

set -euo pipefail

PROFILE="${AWS_PROFILE:-hackathon}"
BUCKET="${BOOTH_S3_BUCKET:-boothapp-sessions}"
BACKUP_ROOT="./backups"
DATE=$(date '+%Y-%m-%d')
BACKUP_DIR="${BACKUP_ROOT}/${DATE}"
COMPRESS=false
RESTORE_PATH=""

green() { printf '\033[32m  OK\033[0m %s\n' "$1"; }
red()   { printf '\033[31m  ERR\033[0m %s\n' "$1"; }
info()  { printf '\033[36m  --\033[0m %s\n' "$1"; }

usage() {
  cat <<'USAGE'
Usage: bash scripts/backup-sessions.sh [OPTIONS]

Download all session data from S3 to ./backups/<date>/

Options:
  --compress          Create a .tar.gz archive after download
  --restore <path>    Restore a backup directory back to S3
  -h, --help          Show this help

Environment:
  AWS_PROFILE         AWS CLI profile (default: hackathon)
  BOOTH_S3_BUCKET     S3 bucket name (default: boothapp-sessions)

Examples:
  bash scripts/backup-sessions.sh
  bash scripts/backup-sessions.sh --compress
  bash scripts/backup-sessions.sh --restore ./backups/2026-03-31
USAGE
  exit 0
}

# ── Parse args ──────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --compress)  COMPRESS=true; shift ;;
    --restore)
      RESTORE_PATH="${2:-}"
      if [[ -z "$RESTORE_PATH" ]]; then
        red "--restore requires a path argument"
        exit 1
      fi
      shift 2 ;;
    -h|--help) usage ;;
    *) red "Unknown option: $1"; usage ;;
  esac
done

# ── Restore mode ────────────────────────────────
if [[ -n "$RESTORE_PATH" ]]; then
  if [[ ! -d "$RESTORE_PATH" ]]; then
    red "Backup path not found: $RESTORE_PATH"
    exit 1
  fi

  info "Restoring from $RESTORE_PATH to s3://$BUCKET/"
  aws s3 sync "$RESTORE_PATH" "s3://$BUCKET/" --profile "$PROFILE"
  green "Restore complete"

  # Verify restore
  S3_COUNT=$(aws s3api list-objects-v2 --bucket "$BUCKET" --profile "$PROFILE" --query 'length(Contents)' --output text 2>/dev/null || echo "0")
  LOCAL_COUNT=$(find "$RESTORE_PATH" -type f | wc -l | tr -d ' ')
  info "S3 objects after restore: $S3_COUNT | Local files uploaded: $LOCAL_COUNT"
  exit 0
fi

# ── Backup mode (default) ──────────────────────
echo "============================================"
echo "  BoothApp Session Backup"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

# Check AWS access
if ! aws sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1; then
  red "AWS CLI not configured (profile: $PROFILE)"
  exit 1
fi
green "AWS access verified"

# Count S3 objects before sync
info "Counting objects in s3://$BUCKET/ ..."
S3_COUNT=$(aws s3api list-objects-v2 --bucket "$BUCKET" --profile "$PROFILE" --query 'length(Contents)' --output text 2>/dev/null || echo "0")
if [[ "$S3_COUNT" == "None" || "$S3_COUNT" == "0" ]]; then
  red "No objects found in s3://$BUCKET/"
  exit 1
fi
info "S3 objects: $S3_COUNT"

# Sync from S3
mkdir -p "$BACKUP_DIR"
info "Syncing s3://$BUCKET/ -> $BACKUP_DIR/"
aws s3 sync "s3://$BUCKET/" "$BACKUP_DIR/" --profile "$PROFILE"
green "Download complete"

# ── Verify integrity ───────────────────────────
LOCAL_COUNT=$(find "$BACKUP_DIR" -type f | wc -l | tr -d ' ')
info "Verifying: S3=$S3_COUNT, Local=$LOCAL_COUNT"

if [[ "$LOCAL_COUNT" -eq "$S3_COUNT" ]]; then
  green "Integrity check passed ($LOCAL_COUNT files match)"
else
  red "Integrity mismatch: S3 has $S3_COUNT objects, local has $LOCAL_COUNT files"
  info "This may be normal if S3 has zero-byte directory markers"
fi

# ── Summary ─────────────────────────────────────
echo ""
echo "--------------------------------------------"
echo "  Backup Summary"
echo "--------------------------------------------"

# Count sessions (top-level directories)
SESSION_COUNT=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)

# Newest and oldest session by directory modification time
OLDEST=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T+ %f\n' 2>/dev/null | sort | head -1 | awk '{print $2}')
NEWEST=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T+ %f\n' 2>/dev/null | sort | tail -1 | awk '{print $2}')

# Fallback for macOS (no -printf)
if [[ -z "${OLDEST:-}" ]]; then
  OLDEST=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -exec stat -f '%m %N' {} \; 2>/dev/null | sort -n | head -1 | awk '{print $2}' | xargs basename 2>/dev/null || echo "N/A")
  NEWEST=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -exec stat -f '%m %N' {} \; 2>/dev/null | sort -n | tail -1 | awk '{print $2}' | xargs basename 2>/dev/null || echo "N/A")
fi

printf "  Sessions:  %s\n" "$SESSION_COUNT"
printf "  Size:      %s\n" "$TOTAL_SIZE"
printf "  Oldest:    %s\n" "${OLDEST:-N/A}"
printf "  Newest:    %s\n" "${NEWEST:-N/A}"
echo "--------------------------------------------"

# ── Compress (optional) ────────────────────────
if $COMPRESS; then
  ARCHIVE="${BACKUP_ROOT}/boothapp-sessions-${DATE}.tar.gz"
  info "Compressing -> $ARCHIVE"
  tar -czf "$ARCHIVE" -C "$BACKUP_ROOT" "$DATE"
  ARCHIVE_SIZE=$(du -sh "$ARCHIVE" | cut -f1)
  green "Archive created: $ARCHIVE ($ARCHIVE_SIZE)"
fi

echo ""
green "Backup complete: $BACKUP_DIR"
