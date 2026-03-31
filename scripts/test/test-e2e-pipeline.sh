#!/usr/bin/env bash
# test-e2e-pipeline.sh — End-to-end integration test for the full boothapp pipeline.
#
# Proves the complete flow works:
#   1. Generate realistic sample session (metadata, clicks, screenshots, transcript)
#   2. Upload to S3 under a test session ID
#   3. Wait for watcher to detect and process it (poll for output/summary.json)
#   4. Validate output: summary.json has required fields, HTML report exists
#   5. Clean up test session from S3
#   6. Exit 0 on success, non-zero with descriptive error on failure
#
# Prerequisites:
#   - AWS CLI configured with hackathon profile
#   - Watcher running: S3_BUCKET=boothapp-sessions-752266476357 AWS_REGION=us-east-1 node analysis/watcher.js
#
# Usage:
#   bash scripts/test/test-e2e-pipeline.sh
#   bash scripts/test/test-e2e-pipeline.sh --no-cleanup   # keep test data for debugging
set -euo pipefail

###############################################################################
# Config
###############################################################################
AWS_PROFILE="${AWS_PROFILE:-hackathon}"
AWS_REGION="${AWS_REGION:-us-east-1}"
S3_BUCKET="${S3_BUCKET:-boothapp-sessions-752266476357}"
S3_URI="s3://${S3_BUCKET}"
AWS="aws --profile ${AWS_PROFILE} --region ${AWS_REGION}"

SESSION_ID="E2E-TEST-$(date +%s)-$$"
PREFIX="sessions/${SESSION_ID}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STARTED=$(date -u -d '2 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-2M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$NOW")

POLL_TIMEOUT=120
POLL_INTERVAL=5
CLEANUP=true

if [[ "${1:-}" == "--no-cleanup" ]]; then
  CLEANUP=false
fi

###############################################################################
# Helpers
###############################################################################
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }

die() {
  echo ""
  echo "  [FATAL] $1"
  echo ""
  echo "Results: ${PASS} passed, ${FAIL} failed"
  exit 1
}

TMP=$(mktemp -d)
cleanup() {
  if $CLEANUP; then
    echo ""
    echo "--- Cleaning up test session ${SESSION_ID} ---"
    ${AWS} s3 rm "${S3_URI}/${PREFIX}/" --recursive --quiet 2>/dev/null || true
    echo "  Cleaned."
  else
    echo ""
    echo "--- Skipping cleanup (--no-cleanup). Data at ${S3_URI}/${PREFIX}/ ---"
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

###############################################################################
# Preflight: verify AWS access
###############################################################################
echo "=============================================="
echo " BoothApp E2E Pipeline Test"
echo " Session: ${SESSION_ID}"
echo " Bucket:  ${S3_BUCKET}"
echo " Region:  ${AWS_REGION}"
echo "=============================================="
echo ""

echo "--- Preflight: verifying AWS access ---"
if ! ${AWS} s3 ls "s3://${S3_BUCKET}/" --max-items 1 >/dev/null 2>&1; then
  die "Cannot access S3 bucket ${S3_BUCKET}. Check AWS_PROFILE=${AWS_PROFILE} and AWS_REGION=${AWS_REGION}."
fi
pass "AWS credentials and bucket access OK"

###############################################################################
# Step 1: Generate and upload realistic sample session
###############################################################################
echo ""
echo "--- Step 1: Generating and uploading sample session ---"

# -- metadata.json (status: ended triggers watcher) --
cat > "${TMP}/metadata.json" <<ENDJSON
{
  "session_id": "${SESSION_ID}",
  "visitor_name": "Alex Rivera",
  "company": "Contoso Security Inc.",
  "badge_photo": "badge.jpg",
  "started_at": "${STARTED}",
  "ended_at": "${NOW}",
  "demo_pc": "booth-pc-e2e",
  "se_name": "Demo Engineer",
  "audio_consent": true,
  "status": "ended",
  "upload_complete": true
}
ENDJSON

${AWS} s3 cp "${TMP}/metadata.json" "${S3_URI}/${PREFIX}/metadata.json" --quiet
pass "metadata.json uploaded"

# -- clicks/clicks.json --
cat > "${TMP}/clicks.json" <<ENDJSON
{
  "session_id": "${SESSION_ID}",
  "events": [
    {
      "index": 1,
      "timestamp": "${STARTED}",
      "type": "click",
      "dom_path": "div.dashboard > nav > a.overview",
      "element": {
        "tag": "a",
        "id": "dash-overview",
        "class": "overview",
        "text": "Risk Overview",
        "href": "/app/risk-overview"
      },
      "coordinates": {"x": 200, "y": 80},
      "page_url": "https://portal.xdr.trendmicro.com/app/dashboard",
      "page_title": "Vision One - Dashboard",
      "screenshot_file": "screenshots/click-001.jpg"
    },
    {
      "index": 2,
      "timestamp": "${STARTED}",
      "type": "click",
      "dom_path": "div.sidebar > a.endpoint-security",
      "element": {
        "tag": "a",
        "id": "ep-nav",
        "class": "endpoint-security",
        "text": "Endpoint Security",
        "href": "/app/endpoint-security"
      },
      "coordinates": {"x": 150, "y": 250},
      "page_url": "https://portal.xdr.trendmicro.com/app/risk-overview",
      "page_title": "Vision One - Risk Overview",
      "screenshot_file": "screenshots/click-002.jpg"
    },
    {
      "index": 3,
      "timestamp": "${NOW}",
      "type": "click",
      "dom_path": "div.xdr > button.run-search",
      "element": {
        "tag": "button",
        "id": "run-search",
        "class": "run-search",
        "text": "Search",
        "href": null
      },
      "coordinates": {"x": 800, "y": 400},
      "page_url": "https://portal.xdr.trendmicro.com/app/xdr/search",
      "page_title": "Vision One - XDR Threat Investigation",
      "screenshot_file": "screenshots/click-003.jpg"
    }
  ]
}
ENDJSON

${AWS} s3 cp "${TMP}/clicks.json" "${S3_URI}/${PREFIX}/clicks/clicks.json" --quiet
pass "clicks/clicks.json uploaded (3 click events)"

# -- screenshots (1x1 JPEG placeholders) --
# Generate minimal valid JPEG: FF D8 FF E0 header + minimal data
printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9' > "${TMP}/placeholder.jpg"

for i in 001 002 003; do
  cp "${TMP}/placeholder.jpg" "${TMP}/click-${i}.jpg"
done
${AWS} s3 cp "${TMP}/click-001.jpg" "${S3_URI}/${PREFIX}/screenshots/click-001.jpg" --quiet
${AWS} s3 cp "${TMP}/click-002.jpg" "${S3_URI}/${PREFIX}/screenshots/click-002.jpg" --quiet
${AWS} s3 cp "${TMP}/click-003.jpg" "${S3_URI}/${PREFIX}/screenshots/click-003.jpg" --quiet
pass "screenshots uploaded (3 placeholder JPEGs)"

# -- transcript/transcript.json --
cat > "${TMP}/transcript.json" <<ENDJSON
{
  "session_id": "${SESSION_ID}",
  "source": "recording.wav",
  "duration_seconds": 180,
  "entries": [
    {
      "timestamp": "00:00:05.000",
      "speaker": "SE",
      "text": "Welcome to Vision One. Let me walk you through our unified cybersecurity platform."
    },
    {
      "timestamp": "00:00:20.000",
      "speaker": "Visitor",
      "text": "Thanks. We are evaluating XDR solutions for our 10,000 endpoint environment."
    },
    {
      "timestamp": "00:00:45.000",
      "speaker": "SE",
      "text": "Great. Let me start with the risk overview dashboard. This gives you a single pane of glass across endpoint, email, network, and cloud."
    },
    {
      "timestamp": "00:01:15.000",
      "speaker": "Visitor",
      "text": "How does the endpoint protection integrate with your XDR detection capabilities?"
    },
    {
      "timestamp": "00:01:40.000",
      "speaker": "SE",
      "text": "Endpoint telemetry feeds directly into XDR. Detections are correlated across all vectors automatically. Let me show you the search interface."
    },
    {
      "timestamp": "00:02:10.000",
      "speaker": "Visitor",
      "text": "Can we do custom detection rules? We have specific compliance requirements for PCI DSS."
    },
    {
      "timestamp": "00:02:30.000",
      "speaker": "SE",
      "text": "Absolutely. You can create custom YARA rules and search queries. I will show you how."
    },
    {
      "timestamp": "00:02:50.000",
      "speaker": "Visitor",
      "text": "This looks promising. Can we get a trial tenant to test with our SOC team?"
    }
  ]
}
ENDJSON

${AWS} s3 cp "${TMP}/transcript.json" "${S3_URI}/${PREFIX}/transcript/transcript.json" --quiet
pass "transcript/transcript.json uploaded (8 entries, 180s)"

# Verify all uploads landed
UPLOAD_COUNT=$(${AWS} s3 ls "${S3_URI}/${PREFIX}/" --recursive | wc -l | tr -d ' ')
if [ "$UPLOAD_COUNT" -ge 7 ]; then
  pass "All files visible in S3 (${UPLOAD_COUNT} objects)"
else
  fail "Expected >= 7 objects in S3, found ${UPLOAD_COUNT}"
fi

###############################################################################
# Step 2: Poll for watcher to process the session (output/summary.json)
###############################################################################
echo ""
echo "--- Step 2: Waiting for pipeline output (timeout: ${POLL_TIMEOUT}s) ---"
echo "  Polling for ${S3_URI}/${PREFIX}/output/summary.json ..."

ELAPSED=0
FOUND=false

while [ "$ELAPSED" -lt "$POLL_TIMEOUT" ]; do
  if ${AWS} s3 ls "${S3_URI}/${PREFIX}/output/summary.json" >/dev/null 2>&1; then
    FOUND=true
    break
  fi
  printf "  ... %3ds / %ds\r" "$ELAPSED" "$POLL_TIMEOUT"
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done
echo ""

if $FOUND; then
  pass "output/summary.json appeared after ~${ELAPSED}s"
else
  fail "output/summary.json not found within ${POLL_TIMEOUT}s"
  echo ""
  echo "  Is the watcher running?"
  echo "    S3_BUCKET=${S3_BUCKET} AWS_REGION=${AWS_REGION} AWS_PROFILE=${AWS_PROFILE} node analysis/watcher.js"
  echo ""
  echo "  Listing output/ contents:"
  ${AWS} s3 ls "${S3_URI}/${PREFIX}/output/" 2>/dev/null || echo "    (empty or missing)"
  die "Pipeline did not produce output within timeout"
fi

###############################################################################
# Step 3: Download and validate summary.json
###############################################################################
echo ""
echo "--- Step 3: Validating summary.json ---"

${AWS} s3 cp "${S3_URI}/${PREFIX}/output/summary.json" "${TMP}/summary.json" --quiet

# Valid JSON?
if python3 -c "import json; json.load(open('${TMP}/summary.json'))" 2>/dev/null; then
  pass "summary.json is valid JSON"
else
  fail "summary.json is not valid JSON"
  cat "${TMP}/summary.json" | head -20
  die "Cannot validate fields on invalid JSON"
fi

# Required fields (mapped from spec: visitor_name, key_insights->key_interests, recommendations->follow_up_actions)
REQUIRED_FIELDS="session_id visitor_name key_interests follow_up_actions executive_summary"
for field in $REQUIRED_FIELDS; do
  HAS=$(python3 -c "
import json
d = json.load(open('${TMP}/summary.json'))
v = d.get('${field}')
if v is not None and v != '' and v != []:
    print('yes')
else:
    print('no')
" 2>/dev/null || echo "error")

  if [ "$HAS" = "yes" ]; then
    pass "summary.json has non-empty field '${field}'"
  else
    fail "summary.json field '${field}' is missing or empty"
  fi
done

# Session ID matches
SID=$(python3 -c "import json; print(json.load(open('${TMP}/summary.json')).get('session_id',''))" 2>/dev/null || echo "")
if [ "$SID" = "$SESSION_ID" ]; then
  pass "session_id matches (${SESSION_ID})"
else
  fail "session_id mismatch: expected '${SESSION_ID}', got '${SID}'"
fi

# visitor_name matches
VNAME=$(python3 -c "import json; print(json.load(open('${TMP}/summary.json')).get('visitor_name',''))" 2>/dev/null || echo "")
if [ "$VNAME" = "Alex Rivera" ]; then
  pass "visitor_name matches input ('Alex Rivera')"
else
  fail "visitor_name: expected 'Alex Rivera', got '${VNAME}'"
fi

###############################################################################
# Step 4: Validate HTML report exists
###############################################################################
echo ""
echo "--- Step 4: Checking HTML report ---"

if ${AWS} s3 ls "${S3_URI}/${PREFIX}/output/summary.html" >/dev/null 2>&1; then
  pass "output/summary.html exists"

  # Download and basic sanity check
  ${AWS} s3 cp "${S3_URI}/${PREFIX}/output/summary.html" "${TMP}/summary.html" --quiet
  if grep -qi '<html' "${TMP}/summary.html" 2>/dev/null; then
    pass "summary.html contains <html> tag"
  else
    fail "summary.html does not appear to be valid HTML"
  fi
else
  fail "output/summary.html not found"
fi

###############################################################################
# Step 5: Check optional outputs (informational, non-fatal)
###############################################################################
echo ""
echo "--- Step 5: Optional outputs ---"

for file in "output/timeline.json" "output/follow-up.json" "output/.analysis-claimed"; do
  if ${AWS} s3 ls "${S3_URI}/${PREFIX}/${file}" >/dev/null 2>&1; then
    echo "  [INFO] ${file} exists"
  else
    echo "  [INFO] ${file} not found (optional)"
  fi
done

###############################################################################
# Results
###############################################################################
echo ""
echo "=============================================="
echo " E2E Pipeline Test Results"
echo "   PASS: ${PASS}"
echo "   FAIL: ${FAIL}"
echo "   Session: ${SESSION_ID}"
echo "=============================================="

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "   *** ${FAIL} check(s) FAILED ***"
  exit 1
fi

echo ""
echo "   All checks passed -- full pipeline is working."
exit 0
