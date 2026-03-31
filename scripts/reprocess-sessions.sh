#!/usr/bin/env bash
# reprocess-sessions.sh -- Find sessions that need (re)analysis and reset them.
#
# Lists all S3 sessions that have metadata.json but no output/summary.json,
# then deletes the .analysis-claimed marker so the watcher picks them up again.
# Useful after prompt improvements or pipeline bug fixes.
#
# Usage:
#   bash scripts/reprocess-sessions.sh              # execute reprocessing
#   bash scripts/reprocess-sessions.sh --dry-run    # show what would happen
#   bash scripts/reprocess-sessions.sh --force      # also reset sessions that have summary.json
#   bash scripts/reprocess-sessions.sh --help
#
set -euo pipefail

###############################################################################
# Config (matches other scripts)
###############################################################################
BUCKET="boothapp-sessions-752266476357"
S3_BUCKET="s3://${BUCKET}"
AWS="aws --profile hackathon --region us-east-2"

###############################################################################
# Args
###############################################################################
DRY_RUN=false
FORCE=false

usage() {
  cat <<'USAGE'
Usage: reprocess-sessions.sh [OPTIONS]

Find S3 sessions missing analysis output and re-trigger the watcher.

Options:
  --dry-run   Show what would be reset, but don't change anything
  --force     Also reset sessions that already have summary.json
              (re-analyze everything, not just failures)
  -h, --help  Show this help

How it works:
  1. Lists all session prefixes in s3://BUCKET/sessions/
  2. For each session with metadata.json but no output/summary.json:
     - Deletes output/.analysis-claimed marker (if present)
     - Deletes output/error.json (if present)
     - Resets metadata.json analysis_status field to empty
  3. The running watcher picks up unclaimed sessions on its next poll cycle

With --force, step 2 applies to ALL sessions (even those with summary.json),
allowing full re-analysis after prompt improvements.
USAGE
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN=true; shift ;;
    --force)    FORCE=true; shift ;;
    -h|--help)  usage ;;
    *)          echo "Unknown option: $1"; usage ;;
  esac
done

###############################################################################
# Verify AWS access
###############################################################################
if ! ${AWS} sts get-caller-identity >/dev/null 2>&1; then
  echo "ERROR: AWS credentials not valid (profile: hackathon)"
  exit 1
fi

###############################################################################
# Discover sessions
###############################################################################
echo "Scanning ${S3_BUCKET}/sessions/ ..."
echo ""

SESSION_IDS=$(${AWS} s3api list-objects-v2 \
  --bucket "${BUCKET}" \
  --prefix "sessions/" \
  --delimiter "/" \
  --query "CommonPrefixes[].Prefix" \
  --output text 2>/dev/null \
  | tr '\t' '\n' \
  | sed -n 's|^sessions/\(.*\)/$|\1|p' \
  | sort)

if [[ -z "$SESSION_IDS" ]]; then
  echo "No sessions found."
  exit 0
fi

TOTAL=0
NEEDS_REPROCESS=0
SKIPPED=0

for SID in $SESSION_IDS; do
  TOTAL=$((TOTAL + 1))
  PREFIX="sessions/${SID}"

  # Must have metadata.json
  if ! ${AWS} s3api head-object --bucket "${BUCKET}" --key "${PREFIX}/metadata.json" >/dev/null 2>&1; then
    continue
  fi

  # Check if output/summary.json exists
  HAS_SUMMARY=false
  if ${AWS} s3api head-object --bucket "${BUCKET}" --key "${PREFIX}/output/summary.json" >/dev/null 2>&1; then
    HAS_SUMMARY=true
  fi

  # Skip sessions that already have analysis output (unless --force)
  if $HAS_SUMMARY && ! $FORCE; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  NEEDS_REPROCESS=$((NEEDS_REPROCESS + 1))

  # Check what markers exist
  HAS_CLAIMED=false
  if ${AWS} s3api head-object --bucket "${BUCKET}" --key "${PREFIX}/output/.analysis-claimed" >/dev/null 2>&1; then
    HAS_CLAIMED=true
  fi

  HAS_ERROR=false
  if ${AWS} s3api head-object --bucket "${BUCKET}" --key "${PREFIX}/output/error.json" >/dev/null 2>&1; then
    HAS_ERROR=true
  fi

  # Report
  STATUS_LABEL="missing-summary"
  if $HAS_SUMMARY; then
    STATUS_LABEL="force-reprocess"
  fi

  MARKERS=""
  $HAS_CLAIMED && MARKERS="${MARKERS} claimed"
  $HAS_ERROR   && MARKERS="${MARKERS} error"
  [[ -z "$MARKERS" ]] && MARKERS=" (no markers)"

  if $DRY_RUN; then
    echo "[DRY-RUN] ${SID}  status=${STATUS_LABEL}  markers=${MARKERS}"
  else
    echo "Resetting ${SID}  status=${STATUS_LABEL}  markers=${MARKERS}"

    # Delete the claim marker so watcher re-processes
    if $HAS_CLAIMED; then
      ${AWS} s3 rm "${S3_BUCKET}/${PREFIX}/output/.analysis-claimed" --quiet 2>/dev/null || true
    fi

    # Delete error.json so it doesn't confuse the dashboard
    if $HAS_ERROR; then
      ${AWS} s3 rm "${S3_BUCKET}/${PREFIX}/output/error.json" --quiet 2>/dev/null || true
    fi

    # If force-reprocessing, also delete existing output so it's fully regenerated
    if $FORCE && $HAS_SUMMARY; then
      ${AWS} s3 rm "${S3_BUCKET}/${PREFIX}/output/" --recursive --quiet 2>/dev/null || true
    fi
  fi
done

###############################################################################
# Summary
###############################################################################
echo ""
echo "=============================================="
echo " Sessions scanned:      ${TOTAL}"
echo " Already analyzed:      ${SKIPPED}"
echo " Need (re)processing:   ${NEEDS_REPROCESS}"
if $DRY_RUN; then
  echo " Mode:                  DRY-RUN (no changes made)"
  echo ""
  echo " Run without --dry-run to reset these sessions."
else
  echo " Mode:                  LIVE"
  echo ""
  if [[ "$NEEDS_REPROCESS" -gt 0 ]]; then
    echo " Markers cleared. The watcher will pick these up on its next poll."
    echo " Monitor with: node analysis/watcher.js"
  fi
fi
echo "=============================================="
