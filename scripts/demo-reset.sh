#!/usr/bin/env bash
# demo-reset.sh -- Clean up DEMO-* sessions from S3 and reset local watcher state.
# Run this before a hackathon demo to start fresh.
#
# Usage:
#   ./scripts/demo-reset.sh           # interactive confirmation
#   ./scripts/demo-reset.sh --force   # skip confirmation

set -euo pipefail

PROFILE="${AWS_PROFILE:-hackathon}"
BUCKET="${BOOTH_S3_BUCKET:-boothapp-recordings}"
SESSIONS_DIR="${SESSIONS_DIR:-sessions}"
PREFIX="sessions/DEMO-"
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=true ;;
    --help|-h)
      echo "Usage: $0 [--force]"
      echo ""
      echo "Deletes all sessions/DEMO-* objects from S3 and removes local"
      echo "DEMO-* session directories. Resets watcher state for a clean demo."
      echo ""
      echo "Options:"
      echo "  --force, -f   Skip confirmation prompt"
      echo ""
      echo "Environment:"
      echo "  AWS_PROFILE       AWS profile (default: hackathon)"
      echo "  BOOTH_S3_BUCKET   S3 bucket  (default: boothapp-recordings)"
      echo "  SESSIONS_DIR      Local sessions dir (default: sessions)"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--force]" >&2
      exit 1
      ;;
  esac
done

# ── Discover what will be deleted ───────────────────────────────────────────

echo "============================================"
echo "  BoothApp Demo Reset"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""
echo "Bucket:  s3://$BUCKET"
echo "Prefix:  $PREFIX"
echo "Profile: $PROFILE"
echo ""

# Count S3 objects
S3_OBJECTS=$(aws s3api list-objects-v2 \
  --bucket "$BUCKET" \
  --prefix "$PREFIX" \
  --profile "$PROFILE" \
  --query 'Contents[].Key' \
  --output text 2>/dev/null || true)

if [ -z "$S3_OBJECTS" ] || [ "$S3_OBJECTS" = "None" ]; then
  S3_COUNT=0
else
  S3_COUNT=$(echo "$S3_OBJECTS" | wc -w)
fi

# Count local DEMO-* session dirs
LOCAL_COUNT=0
if [ -d "$SESSIONS_DIR" ]; then
  LOCAL_COUNT=$(find "$SESSIONS_DIR" -maxdepth 1 -type d -name 'DEMO-*' 2>/dev/null | wc -l)
fi

echo "Found:"
echo "  S3 objects:        $S3_COUNT"
echo "  Local directories: $LOCAL_COUNT"
echo ""

if [ "$S3_COUNT" -eq 0 ] && [ "$LOCAL_COUNT" -eq 0 ]; then
  echo "Nothing to clean up. Already fresh."
  exit 0
fi

# ── Confirmation ────────────────────────────────────────────────────────────

if [ "$FORCE" = false ]; then
  printf "Delete all DEMO-* sessions? [y/N] "
  read -r CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Aborted."
    exit 0
  fi
fi

# ── Delete S3 objects ───────────────────────────────────────────────────────

if [ "$S3_COUNT" -gt 0 ]; then
  echo ""
  echo "Deleting S3 objects under s3://$BUCKET/$PREFIX ..."
  aws s3 rm "s3://$BUCKET/$PREFIX" \
    --recursive \
    --profile "$PROFILE"
  echo "  Deleted $S3_COUNT S3 object(s)."
fi

# ── Remove local session directories ────────────────────────────────────────

if [ "$LOCAL_COUNT" -gt 0 ]; then
  echo ""
  echo "Removing local DEMO-* session directories..."
  find "$SESSIONS_DIR" -maxdepth 1 -type d -name 'DEMO-*' -exec rm -rf {} +
  echo "  Removed $LOCAL_COUNT local directory(ies)."
fi

# ── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "============================================"
echo "  Demo reset complete. Ready for a fresh demo."
echo "============================================"
