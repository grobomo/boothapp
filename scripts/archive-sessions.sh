#!/usr/bin/env bash
#
# archive-sessions.sh - Archive old BoothApp sessions in S3
#
# Moves sessions older than N days from sessions/ to archive/ prefix.
# Keeps metadata (metadata.json, badge.json, clicks.json, summary.html)
# but removes large files (screenshots/, audio.webm) from active storage.
#
# Usage:
#   bash scripts/archive-sessions.sh --days 7 [--dry-run] [--delete-old] [--bucket NAME]
#

set -euo pipefail

# ---- Defaults ----
DAYS=7
DRY_RUN=false
DELETE_OLD=false
BUCKET="${S3_BUCKET:-boothapp-sessions}"
ARCHIVE_DELETE_DAYS=30
LOG_FILE="archive-sessions-$(date +%Y%m%d-%H%M%S).log"

# ---- Parse args ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --days)       DAYS="$2"; shift 2 ;;
        --dry-run)    DRY_RUN=true; shift ;;
        --delete-old) DELETE_OLD=true; shift ;;
        --bucket)     BUCKET="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: bash scripts/archive-sessions.sh --days N [--dry-run] [--delete-old] [--bucket NAME]"
            echo ""
            echo "Options:"
            echo "  --days N        Archive sessions older than N days (default: 7)"
            echo "  --dry-run       Show what would be archived without doing it"
            echo "  --delete-old    Delete archived sessions older than ${ARCHIVE_DELETE_DAYS} days"
            echo "  --bucket NAME   S3 bucket name (default: \$S3_BUCKET or boothapp-sessions)"
            echo "  --help          Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# ---- Helpers ----
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE"
}

# Large file patterns to remove from active storage (keep in archive)
LARGE_FILE_PATTERNS=("screenshots/" "audio.webm" "screen-recording.webm")

# ---- Validate ----
if ! command -v aws &>/dev/null; then
    echo "ERROR: aws CLI not found. Install it first." >&2
    exit 1
fi

log "=== BoothApp Session Archival ==="
log "Bucket:      s3://${BUCKET}"
log "Days:        ${DAYS}"
log "Dry run:     ${DRY_RUN}"
log "Delete old:  ${DELETE_OLD}"
log "Log file:    ${LOG_FILE}"
log ""

# ---- Get cutoff date ----
CUTOFF_EPOCH=$(date -d "-${DAYS} days" +%s 2>/dev/null || date -v-${DAYS}d +%s 2>/dev/null)
CUTOFF_ISO=$(date -d "@${CUTOFF_EPOCH}" -Iseconds 2>/dev/null || date -r "${CUTOFF_EPOCH}" -Iseconds 2>/dev/null)
log "Cutoff date: ${CUTOFF_ISO} (sessions older than this will be archived)"
log ""

# ---- List session prefixes ----
log "Scanning sessions in s3://${BUCKET}/..."

SESSION_PREFIXES=$(aws s3api list-objects-v2 \
    --bucket "${BUCKET}" \
    --delimiter "/" \
    --query "CommonPrefixes[].Prefix" \
    --output text 2>/dev/null || echo "")

if [[ -z "$SESSION_PREFIXES" || "$SESSION_PREFIXES" == "None" ]]; then
    log "No sessions found in bucket."
    exit 0
fi

ARCHIVED_COUNT=0
SKIPPED_COUNT=0
DELETED_COUNT=0

# ---- Process each session ----
for PREFIX in $SESSION_PREFIXES; do
    SESSION_ID="${PREFIX%/}"

    # Skip archive/ prefix itself
    if [[ "$SESSION_ID" == "archive" || "$SESSION_ID" == archive/* ]]; then
        continue
    fi

    # Try to get metadata.json for created_at timestamp
    METADATA=$(aws s3 cp "s3://${BUCKET}/${SESSION_ID}/metadata.json" - 2>/dev/null || echo "{}")
    CREATED_AT=$(echo "$METADATA" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('created_at', ''))
except:
    print('')
" 2>/dev/null || echo "")

    # If no created_at, check the LastModified of the metadata.json object
    if [[ -z "$CREATED_AT" ]]; then
        LAST_MODIFIED=$(aws s3api head-object \
            --bucket "${BUCKET}" \
            --key "${SESSION_ID}/metadata.json" \
            --query "LastModified" \
            --output text 2>/dev/null || echo "")

        if [[ -z "$LAST_MODIFIED" || "$LAST_MODIFIED" == "None" ]]; then
            log "SKIP ${SESSION_ID} - no metadata or timestamp found"
            SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
            continue
        fi
        CREATED_AT="$LAST_MODIFIED"
    fi

    # Parse created_at to epoch
    SESSION_EPOCH=$(date -d "${CREATED_AT}" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%S" "${CREATED_AT}" +%s 2>/dev/null || echo "0")

    if [[ "$SESSION_EPOCH" -eq 0 ]]; then
        log "SKIP ${SESSION_ID} - could not parse date: ${CREATED_AT}"
        SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
        continue
    fi

    # Check if session is older than cutoff
    if [[ "$SESSION_EPOCH" -ge "$CUTOFF_EPOCH" ]]; then
        SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
        continue
    fi

    AGE_DAYS=$(( ($(date +%s) - SESSION_EPOCH) / 86400 ))
    log "ARCHIVE ${SESSION_ID} (${AGE_DAYS} days old, created ${CREATED_AT})"

    if [[ "$DRY_RUN" == "true" ]]; then
        # List what would be moved
        OBJECTS=$(aws s3api list-objects-v2 \
            --bucket "${BUCKET}" \
            --prefix "${SESSION_ID}/" \
            --query "Contents[].[Key, Size]" \
            --output text 2>/dev/null || echo "")

        while IFS=$'\t' read -r key size; do
            [[ -z "$key" ]] && continue
            FILENAME="${key#${SESSION_ID}/}"
            IS_LARGE=false
            for pattern in "${LARGE_FILE_PATTERNS[@]}"; do
                if [[ "$FILENAME" == $pattern* ]]; then
                    IS_LARGE=true
                    break
                fi
            done

            if [[ "$IS_LARGE" == "true" ]]; then
                SIZE_KB=$(( (size + 1023) / 1024 ))
                log "  [DRY-RUN] Would copy to archive/ and delete: ${key} (${SIZE_KB} KB)"
            else
                log "  [DRY-RUN] Would copy to archive/: ${key}"
            fi
        done <<< "$OBJECTS"
    else
        # 1. Copy entire session to archive/ prefix
        aws s3 cp "s3://${BUCKET}/${SESSION_ID}/" "s3://${BUCKET}/archive/${SESSION_ID}/" \
            --recursive --quiet 2>/dev/null
        log "  Copied to archive/${SESSION_ID}/"

        # 2. Remove large files from active storage
        for pattern in "${LARGE_FILE_PATTERNS[@]}"; do
            MATCHING=$(aws s3api list-objects-v2 \
                --bucket "${BUCKET}" \
                --prefix "${SESSION_ID}/${pattern}" \
                --query "Contents[].Key" \
                --output text 2>/dev/null || echo "")

            if [[ -n "$MATCHING" && "$MATCHING" != "None" ]]; then
                for key in $MATCHING; do
                    aws s3 rm "s3://${BUCKET}/${key}" --quiet 2>/dev/null
                    log "  Removed large file: ${key}"
                done
            fi
        done

        # 3. Update metadata to mark as archived
        UPDATED_META=$(echo "$METADATA" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
except:
    data = {}
data['archived'] = True
data['archived_at'] = '$(date -Iseconds)'
data['archive_prefix'] = 'archive/${SESSION_ID}/'
json.dump(data, sys.stdout, indent=2)
" 2>/dev/null)

        if [[ -n "$UPDATED_META" ]]; then
            echo "$UPDATED_META" | aws s3 cp - "s3://${BUCKET}/${SESSION_ID}/metadata.json" \
                --content-type "application/json" --quiet 2>/dev/null
            log "  Updated metadata with archive info"
        fi
    fi

    ARCHIVED_COUNT=$((ARCHIVED_COUNT + 1))
done

log ""
log "=== Archive Summary ==="
log "Archived:  ${ARCHIVED_COUNT}"
log "Skipped:   ${SKIPPED_COUNT} (newer than ${DAYS} days)"

# ---- Delete old archived sessions ----
if [[ "$DELETE_OLD" == "true" ]]; then
    log ""
    log "=== Cleaning Old Archives (>${ARCHIVE_DELETE_DAYS} days) ==="

    DELETE_CUTOFF_EPOCH=$(date -d "-${ARCHIVE_DELETE_DAYS} days" +%s 2>/dev/null || date -v-${ARCHIVE_DELETE_DAYS}d +%s 2>/dev/null)

    ARCHIVE_PREFIXES=$(aws s3api list-objects-v2 \
        --bucket "${BUCKET}" \
        --prefix "archive/" \
        --delimiter "/" \
        --query "CommonPrefixes[].Prefix" \
        --output text 2>/dev/null || echo "")

    if [[ -n "$ARCHIVE_PREFIXES" && "$ARCHIVE_PREFIXES" != "None" ]]; then
        for A_PREFIX in $ARCHIVE_PREFIXES; do
            A_SESSION="${A_PREFIX#archive/}"
            A_SESSION="${A_SESSION%/}"

            # Get metadata from the archived copy
            A_META=$(aws s3 cp "s3://${BUCKET}/archive/${A_SESSION}/metadata.json" - 2>/dev/null || echo "{}")
            A_CREATED=$(echo "$A_META" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('created_at', ''))
except:
    print('')
" 2>/dev/null || echo "")

            if [[ -z "$A_CREATED" ]]; then
                continue
            fi

            A_EPOCH=$(date -d "${A_CREATED}" +%s 2>/dev/null || echo "0")
            if [[ "$A_EPOCH" -eq 0 || "$A_EPOCH" -ge "$DELETE_CUTOFF_EPOCH" ]]; then
                continue
            fi

            A_AGE=$(( ($(date +%s) - A_EPOCH) / 86400 ))

            if [[ "$DRY_RUN" == "true" ]]; then
                log "[DRY-RUN] Would delete archive/${A_SESSION}/ (${A_AGE} days old)"
            else
                aws s3 rm "s3://${BUCKET}/archive/${A_SESSION}/" --recursive --quiet 2>/dev/null
                log "Deleted archive/${A_SESSION}/ (${A_AGE} days old)"
            fi
            DELETED_COUNT=$((DELETED_COUNT + 1))
        done
    fi

    log "Deleted:   ${DELETED_COUNT} old archives"
fi

if [[ "$DRY_RUN" == "true" ]]; then
    log ""
    log "*** DRY RUN -- no changes were made ***"
fi

log ""
log "Log saved to: ${LOG_FILE}"
