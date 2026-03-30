#!/usr/bin/env bash
# Integration test for the boothapp watcher/analysis pipeline.
#
# Creates a test session in S3 with sample data, then verifies:
#   1. Watcher detects and claims the session (output/.analysis-claimed)
#   2. Analysis pipeline produces output/summary.json with expected fields
#
# Prerequisites:
#   - AWS CLI configured with --profile hackathon
#   - Watcher running (node analysis/watcher.js) with S3_BUCKET set
#
# Usage:
#   bash scripts/test-integration.sh
#   bash scripts/test-integration.sh --no-cleanup   # keep test data in S3
set -euo pipefail

###############################################################################
# Config
###############################################################################
BUCKET="boothapp-sessions-752266476357"
S3_BUCKET="s3://${BUCKET}"
AWS="aws --profile hackathon --region us-east-2"
SESSION_ID="TEST-INT-$(date +%s)"
PREFIX="sessions/${SESSION_ID}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CLAIM_TIMEOUT=60
ANALYSIS_TIMEOUT=120
CLEANUP=true

if [[ "${1:-}" == "--no-cleanup" ]]; then
  CLEANUP=false
fi

###############################################################################
# Helpers
###############################################################################
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "[PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "[FAIL] $1"; }

TMP=$(mktemp -d)
cleanup() {
  if $CLEANUP; then
    echo ""
    echo "--- Cleaning up test session ${SESSION_ID} ---"
    ${AWS} s3 rm "${S3_BUCKET}/${PREFIX}/" --recursive --quiet 2>/dev/null || true
  else
    echo ""
    echo "--- Skipping cleanup (--no-cleanup). Data remains at ${S3_BUCKET}/${PREFIX}/ ---"
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

###############################################################################
# Step 1: Upload test session data
###############################################################################
echo "=============================================="
echo " BoothApp Integration Test"
echo " Session: ${SESSION_ID}"
echo "=============================================="
echo ""

# --- metadata.json (status: ended so watcher treats it as complete) ---
cat > "${TMP}/metadata.json" <<ENDJSON
{
  "session_id": "${SESSION_ID}",
  "visitor_name": "Integration Test Visitor",
  "company": "Test Corp",
  "badge_photo": null,
  "started_at": "${NOW}",
  "ended_at": "${NOW}",
  "demo_pc": "booth-pc-test",
  "se_name": "Test SE",
  "audio_consent": false,
  "status": "ended",
  "upload_complete": true
}
ENDJSON

echo "[1/3] Uploading metadata.json ..."
${AWS} s3 cp "${TMP}/metadata.json" "${S3_BUCKET}/${PREFIX}/metadata.json" --quiet
pass "metadata.json uploaded"

# --- clicks/clicks.json ---
cat > "${TMP}/clicks.json" <<ENDJSON
{
  "session_id": "${SESSION_ID}",
  "events": [
    {
      "index": 1,
      "timestamp": "${NOW}",
      "type": "click",
      "dom_path": "div.dashboard > nav > a.endpoint-security",
      "element": {
        "tag": "a",
        "id": "ep-nav",
        "class": "endpoint-security",
        "text": "Endpoint Security",
        "href": "/app/endpoint-security"
      },
      "coordinates": {"x": 450, "y": 120},
      "page_url": "https://portal.xdr.trendmicro.com/app/dashboard",
      "page_title": "Vision One - Dashboard",
      "screenshot_file": "screenshots/click-001.jpg"
    },
    {
      "index": 2,
      "timestamp": "${NOW}",
      "type": "click",
      "dom_path": "div.xdr > span.detection-detail",
      "element": {
        "tag": "span",
        "id": "det-detail",
        "class": "detection-detail",
        "text": "Detection Details",
        "href": "/app/xdr/detections"
      },
      "coordinates": {"x": 600, "y": 300},
      "page_url": "https://portal.xdr.trendmicro.com/app/xdr",
      "page_title": "Vision One - XDR",
      "screenshot_file": "screenshots/click-002.jpg"
    }
  ]
}
ENDJSON

echo "[2/3] Uploading clicks/clicks.json ..."
${AWS} s3 cp "${TMP}/clicks.json" "${S3_BUCKET}/${PREFIX}/clicks/clicks.json" --quiet
pass "clicks/clicks.json uploaded"

# --- transcript/transcript.json ---
cat > "${TMP}/transcript.json" <<ENDJSON
{
  "session_id": "${SESSION_ID}",
  "source": "recording.wav",
  "duration_seconds": 120,
  "entries": [
    {
      "timestamp": "00:00:03.000",
      "speaker": "SE",
      "text": "Welcome to Vision One. Let me show you our unified security platform."
    },
    {
      "timestamp": "00:00:15.000",
      "speaker": "Visitor",
      "text": "I am interested in endpoint protection and XDR capabilities."
    },
    {
      "timestamp": "00:00:30.000",
      "speaker": "SE",
      "text": "Great. Here is the endpoint security dashboard with real-time risk scoring."
    },
    {
      "timestamp": "00:01:00.000",
      "speaker": "Visitor",
      "text": "Can you show me how detections are correlated across different vectors?"
    },
    {
      "timestamp": "00:01:30.000",
      "speaker": "SE",
      "text": "Absolutely. XDR correlates endpoint, email, and network telemetry automatically."
    }
  ]
}
ENDJSON

echo "[3/3] Uploading transcript/transcript.json ..."
${AWS} s3 cp "${TMP}/transcript.json" "${S3_BUCKET}/${PREFIX}/transcript/transcript.json" --quiet
pass "transcript/transcript.json uploaded"

echo ""
echo "--- Verifying uploads ---"
LISTING=$(${AWS} s3 ls "${S3_BUCKET}/${PREFIX}/" --recursive)
UPLOAD_COUNT=$(echo "$LISTING" | wc -l)
if [ "$UPLOAD_COUNT" -ge 3 ]; then
  pass "All 3 files visible in S3 (found ${UPLOAD_COUNT} objects)"
else
  fail "Expected >= 3 objects in S3, found ${UPLOAD_COUNT}"
fi

###############################################################################
# Step 2: Wait for watcher to claim the session
###############################################################################
echo ""
echo "--- Waiting for watcher to claim session (timeout: ${CLAIM_TIMEOUT}s) ---"
CLAIMED=false
ELAPSED=0
POLL=5

while [ "$ELAPSED" -lt "$CLAIM_TIMEOUT" ]; do
  if ${AWS} s3 ls "${S3_BUCKET}/${PREFIX}/output/.analysis-claimed" >/dev/null 2>&1; then
    CLAIMED=true
    break
  fi
  echo "  ... waiting (${ELAPSED}s / ${CLAIM_TIMEOUT}s)"
  sleep "$POLL"
  ELAPSED=$((ELAPSED + POLL))
done

if $CLAIMED; then
  pass "Session claimed by watcher (output/.analysis-claimed exists) after ~${ELAPSED}s"
else
  fail "Watcher did not claim session within ${CLAIM_TIMEOUT}s"
  echo ""
  echo "Is the watcher running?"
  echo "  S3_BUCKET=${BUCKET} AWS_REGION=us-east-2 AWS_PROFILE=hackathon node analysis/watcher.js"
  echo ""
  echo "Results: ${PASS} passed, ${FAIL} failed"
  exit 1
fi

###############################################################################
# Step 3: Wait for analysis output (summary.json)
###############################################################################
echo ""
echo "--- Waiting for analysis output (timeout: ${ANALYSIS_TIMEOUT}s) ---"
ANALYSIS_DONE=false
ELAPSED=0
POLL=10

while [ "$ELAPSED" -lt "$ANALYSIS_TIMEOUT" ]; do
  if ${AWS} s3 ls "${S3_BUCKET}/${PREFIX}/output/summary.json" >/dev/null 2>&1; then
    ANALYSIS_DONE=true
    break
  fi
  echo "  ... waiting (${ELAPSED}s / ${ANALYSIS_TIMEOUT}s)"
  sleep "$POLL"
  ELAPSED=$((ELAPSED + POLL))
done

if $ANALYSIS_DONE; then
  pass "output/summary.json exists after ~${ELAPSED}s"
else
  fail "output/summary.json not found within ${ANALYSIS_TIMEOUT}s"
  echo ""
  echo "Listing output/ contents:"
  ${AWS} s3 ls "${S3_BUCKET}/${PREFIX}/output/" 2>/dev/null || echo "  (empty or missing)"
  echo ""
  echo "Results: ${PASS} passed, ${FAIL} failed"
  exit 1
fi

###############################################################################
# Step 4: Validate summary.json fields
###############################################################################
echo ""
echo "--- Validating summary.json ---"
${AWS} s3 cp "${S3_BUCKET}/${PREFIX}/output/summary.json" "${TMP}/summary.json" --quiet

# Check that it is valid JSON
if python3 -c "import json; json.load(open('${TMP}/summary.json'))" 2>/dev/null; then
  pass "summary.json is valid JSON"
else
  fail "summary.json is not valid JSON"
  echo "Results: ${PASS} passed, ${FAIL} failed"
  exit 1
fi

# Check required fields
REQUIRED_FIELDS="session_id visitor_name executive_summary products_shown recommended_follow_up"
for field in $REQUIRED_FIELDS; do
  HAS_FIELD=$(python3 -c "
import json, sys
d = json.load(open('${TMP}/summary.json'))
print('yes' if '${field}' in d else 'no')
" 2>/dev/null || echo "error")

  if [ "$HAS_FIELD" = "yes" ]; then
    pass "summary.json has field '${field}'"
  else
    fail "summary.json missing field '${field}'"
  fi
done

# Check session_id matches
SUMMARY_SID=$(python3 -c "
import json
d = json.load(open('${TMP}/summary.json'))
print(d.get('session_id', ''))
" 2>/dev/null || echo "")

if [ "$SUMMARY_SID" = "$SESSION_ID" ]; then
  pass "summary.json session_id matches test session (${SESSION_ID})"
else
  fail "summary.json session_id mismatch: expected '${SESSION_ID}', got '${SUMMARY_SID}'"
fi

# Check that products_shown is a non-empty array
PRODUCTS_COUNT=$(python3 -c "
import json
d = json.load(open('${TMP}/summary.json'))
p = d.get('products_shown', [])
print(len(p) if isinstance(p, list) else 0)
" 2>/dev/null || echo "0")

if [ "$PRODUCTS_COUNT" -gt 0 ]; then
  pass "summary.json products_shown has ${PRODUCTS_COUNT} entries"
else
  fail "summary.json products_shown is empty or not an array"
fi

###############################################################################
# Step 5: Check for bonus outputs (non-fatal)
###############################################################################
echo ""
echo "--- Checking optional outputs ---"

for file in "output/timeline.json" "output/follow-up.json" "output/summary.html"; do
  if ${AWS} s3 ls "${S3_BUCKET}/${PREFIX}/${file}" >/dev/null 2>&1; then
    echo "[INFO] ${file} exists"
  else
    echo "[INFO] ${file} not found (optional)"
  fi
done

###############################################################################
# Results
###############################################################################
echo ""
echo "=============================================="
echo " Results: ${PASS} passed, ${FAIL} failed"
echo "=============================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo ""
echo "All integration checks passed."
exit 0
