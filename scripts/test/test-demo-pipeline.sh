#!/usr/bin/env bash
#
# test-demo-pipeline.sh -- End-to-end test for the BoothApp processing pipeline.
#
# Uploads synthetic session data to S3, polls for pipeline output, and validates
# the resulting summary artifacts.
#
# Usage: bash scripts/test/test-demo-pipeline.sh
# Requires: aws cli, jq
# AWS_PROFILE defaults to "hackathon"

set -euo pipefail

###############################################################################
# Config
###############################################################################
BUCKET="boothapp-sessions-752266476357"
REGION="us-east-1"
PROFILE="${AWS_PROFILE:-hackathon}"
POLL_INTERVAL=10      # seconds between S3 polls
POLL_TIMEOUT=180      # max seconds to wait for output
SESSION_ID="test-$(date +%Y%m%d-%H%M%S)-$$"

S3_PREFIX="s3://${BUCKET}/sessions/${SESSION_ID}"

PASS=0
FAIL=0
DETAILS=""

###############################################################################
# Helpers
###############################################################################
log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
pass() { PASS=$((PASS + 1)); DETAILS="${DETAILS}\n  [PASS] $1"; log "PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); DETAILS="${DETAILS}\n  [FAIL] $1"; log "FAIL: $1"; }

aws_cmd() {
  aws --profile "$PROFILE" --region "$REGION" "$@"
}

cleanup() {
  log "Cleaning up session ${SESSION_ID} ..."
  aws_cmd s3 rm "${S3_PREFIX}/" --recursive --quiet 2>/dev/null || true
}
trap cleanup EXIT

###############################################################################
# Step 1 -- Generate session data locally
###############################################################################
TMPDIR_LOCAL="$(mktemp -d)"

# metadata.json
cat > "${TMPDIR_LOCAL}/metadata.json" <<'METADATA'
{
  "session_id": "SESSION_ID_PLACEHOLDER",
  "booth_id": "booth-42",
  "status": "ended",
  "started_at": "2026-03-31T10:00:00Z",
  "ended_at": "2026-03-31T10:15:00Z",
  "visitor_name": "Jane Doe",
  "company": "Acme Corp"
}
METADATA
sed -i "s/SESSION_ID_PLACEHOLDER/${SESSION_ID}/" "${TMPDIR_LOCAL}/metadata.json"

# clicks.json -- 5 click events
cat > "${TMPDIR_LOCAL}/clicks.json" <<CLICKS
{
  "session_id": "${SESSION_ID}",
  "events": [
    {"ts": "2026-03-31T10:01:00Z", "element": "product-card-alpha",   "action": "click"},
    {"ts": "2026-03-31T10:02:30Z", "element": "product-card-beta",    "action": "click"},
    {"ts": "2026-03-31T10:04:00Z", "element": "demo-video-play",      "action": "click"},
    {"ts": "2026-03-31T10:07:15Z", "element": "brochure-download",    "action": "click"},
    {"ts": "2026-03-31T10:10:45Z", "element": "contact-form-submit",  "action": "click"}
  ]
}
CLICKS

# transcript.json -- 10 conversation entries
cat > "${TMPDIR_LOCAL}/transcript.json" <<TRANSCRIPT
{
  "session_id": "${SESSION_ID}",
  "entries": [
    {"seq": 1,  "speaker": "rep",     "text": "Welcome to our booth! I am Alex, how can I help you today?"},
    {"seq": 2,  "speaker": "visitor",  "text": "Hi Alex, I am Jane from Acme Corp. We are looking at endpoint security solutions."},
    {"seq": 3,  "speaker": "rep",     "text": "Great! Let me show you our Product Alpha -- it covers endpoint detection and response."},
    {"seq": 4,  "speaker": "visitor",  "text": "That sounds interesting. Does it integrate with our existing SIEM?"},
    {"seq": 5,  "speaker": "rep",     "text": "Absolutely. Product Alpha has native integrations with Splunk, Sentinel, and QRadar."},
    {"seq": 6,  "speaker": "visitor",  "text": "What about cloud workload protection?"},
    {"seq": 7,  "speaker": "rep",     "text": "For that, Product Beta is the right fit. It covers containers and serverless."},
    {"seq": 8,  "speaker": "visitor",  "text": "Can I see a quick demo of the dashboard?"},
    {"seq": 9,  "speaker": "rep",     "text": "Sure, let me pull that up. Here is the real-time threat overview."},
    {"seq": 10, "speaker": "visitor",  "text": "This looks solid. Can you send me the brochure and schedule a follow-up?"}
  ]
}
TRANSCRIPT

###############################################################################
# Step 2 -- Upload to S3
###############################################################################
log "Session ID : ${SESSION_ID}"
log "S3 prefix  : ${S3_PREFIX}"
log "Uploading session data ..."

aws_cmd s3 cp "${TMPDIR_LOCAL}/metadata.json"   "${S3_PREFIX}/metadata.json"            --quiet
aws_cmd s3 cp "${TMPDIR_LOCAL}/clicks.json"      "${S3_PREFIX}/clicks/clicks.json"      --quiet
aws_cmd s3 cp "${TMPDIR_LOCAL}/transcript.json"  "${S3_PREFIX}/transcript/transcript.json" --quiet

log "Upload complete."

###############################################################################
# Step 3 -- Poll for output/summary.json
###############################################################################
log "Polling for output/summary.json (every ${POLL_INTERVAL}s, timeout ${POLL_TIMEOUT}s) ..."

elapsed=0
summary_found=false

while [ "$elapsed" -lt "$POLL_TIMEOUT" ]; do
  if aws_cmd s3 ls "${S3_PREFIX}/output/summary.json" >/dev/null 2>&1; then
    summary_found=true
    break
  fi
  sleep "$POLL_INTERVAL"
  elapsed=$((elapsed + POLL_INTERVAL))
  log "  ... ${elapsed}s elapsed"
done

if [ "$summary_found" = false ]; then
  fail "output/summary.json did not appear within ${POLL_TIMEOUT}s"
  printf '\n============================================================\n'
  printf 'RESULT: FAIL (%d passed, %d failed)\n' "$PASS" "$FAIL"
  printf 'Details:%b\n' "$DETAILS"
  printf '============================================================\n'
  exit 1
fi

pass "output/summary.json appeared after ${elapsed}s"

###############################################################################
# Step 4 -- Download and validate summary.json
###############################################################################
log "Downloading output/summary.json ..."
aws_cmd s3 cp "${S3_PREFIX}/output/summary.json" "${TMPDIR_LOCAL}/summary.json" --quiet

# Required fields
for field in visitor_name products_shown visitor_interests; do
  val=$(jq -r ".${field} // empty" "${TMPDIR_LOCAL}/summary.json" 2>/dev/null || true)
  if [ -n "$val" ]; then
    pass "summary.json has '${field}' = ${val:0:80}"
  else
    fail "summary.json missing or empty field '${field}'"
  fi
done

###############################################################################
# Step 5 -- Verify summary.html exists
###############################################################################
if aws_cmd s3 ls "${S3_PREFIX}/output/summary.html" >/dev/null 2>&1; then
  pass "output/summary.html exists"
else
  fail "output/summary.html not found"
fi

###############################################################################
# Results
###############################################################################
printf '\n============================================================\n'
if [ "$FAIL" -eq 0 ]; then
  printf 'RESULT: PASS (%d checks passed)\n' "$PASS"
else
  printf 'RESULT: FAIL (%d passed, %d failed)\n' "$PASS" "$FAIL"
fi
printf 'Details:%b\n' "$DETAILS"
printf '============================================================\n'

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
