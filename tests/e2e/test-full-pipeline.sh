#!/usr/bin/env bash
# test-full-pipeline.sh -- End-to-end integration test for the full boothapp pipeline.
#
# Proves the complete flow works:
#   1. Create mock session in S3 (metadata, clicks, screenshots, transcript)
#   2. Trigger analysis pipeline (watcher detects session with status=ended)
#   3. Wait for output files (summary.json, summary.html, follow-up.json)
#   4. Validate output structure and content against DATA-CONTRACT.md
#   5. Clean up test data from S3
#   6. Exit 0 on success, non-zero with descriptive error on failure
#
# Prerequisites:
#   - AWS CLI configured with hackathon profile
#   - Watcher running: S3_BUCKET=boothapp-sessions-752266476357 node analysis/watcher.js
#
# Usage:
#   bash tests/e2e/test-full-pipeline.sh
#   bash tests/e2e/test-full-pipeline.sh --no-cleanup   # keep test data for debugging
#   bash tests/e2e/test-full-pipeline.sh --dry-run      # generate + validate locally, skip S3
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

POLL_TIMEOUT="${POLL_TIMEOUT:-120}"
POLL_INTERVAL=5
CLEANUP=true
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --no-cleanup) CLEANUP=false ;;
    --dry-run)    DRY_RUN=true ;;
    --timeout=*)  POLL_TIMEOUT="${arg#--timeout=}" ;;
  esac
done

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

epoch_now() { date +%s; }

TMP=$(mktemp -d)
cleanup() {
  if $DRY_RUN; then
    echo ""
    echo "--- Dry run complete. Generated files at ${TMP} ---"
    return
  fi
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
# Header
###############################################################################
echo "=============================================="
echo " BoothApp E2E Pipeline Test"
echo " Session: ${SESSION_ID}"
echo " Bucket:  ${S3_BUCKET}"
echo " Region:  ${AWS_REGION}"
$DRY_RUN && echo " Mode:    DRY RUN (local only)"
echo "=============================================="
echo ""

###############################################################################
# Preflight: verify AWS access (skip in dry-run)
###############################################################################
if ! $DRY_RUN; then
  echo "--- Preflight: verifying AWS access ---"
  if ! ${AWS} s3 ls "s3://${S3_BUCKET}/" --max-items 1 >/dev/null 2>&1; then
    die "Cannot access S3 bucket ${S3_BUCKET}. Check AWS_PROFILE=${AWS_PROFILE} and AWS_REGION=${AWS_REGION}."
  fi
  pass "AWS credentials and bucket access OK"
else
  echo "--- Preflight: skipped (dry-run) ---"
fi

###############################################################################
# Step 1: Create mock session with sample metadata, clicks, and transcript
###############################################################################
echo ""
echo "--- Step 1: Creating mock session data ---"

T_UPLOAD_START=$(epoch_now)

# -- metadata.json (status: ended + upload_complete triggers watcher) --
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

if ! $DRY_RUN; then
  ${AWS} s3 cp "${TMP}/metadata.json" "${S3_URI}/${PREFIX}/metadata.json" --quiet
fi
pass "metadata.json created"

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

if ! $DRY_RUN; then
  ${AWS} s3 cp "${TMP}/clicks.json" "${S3_URI}/${PREFIX}/clicks/clicks.json" --quiet
fi
pass "clicks/clicks.json created (3 click events)"

# -- screenshots (minimal valid JPEG placeholders) --
printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9' > "${TMP}/placeholder.jpg"

for i in 001 002 003; do
  cp "${TMP}/placeholder.jpg" "${TMP}/click-${i}.jpg"
done
if ! $DRY_RUN; then
  ${AWS} s3 cp "${TMP}/click-001.jpg" "${S3_URI}/${PREFIX}/screenshots/click-001.jpg" --quiet
  ${AWS} s3 cp "${TMP}/click-002.jpg" "${S3_URI}/${PREFIX}/screenshots/click-002.jpg" --quiet
  ${AWS} s3 cp "${TMP}/click-003.jpg" "${S3_URI}/${PREFIX}/screenshots/click-003.jpg" --quiet
fi
pass "screenshots created (3 placeholder JPEGs)"

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

if ! $DRY_RUN; then
  ${AWS} s3 cp "${TMP}/transcript.json" "${S3_URI}/${PREFIX}/transcript/transcript.json" --quiet
fi
pass "transcript/transcript.json created (8 entries, 180s)"

T_UPLOAD_END=$(epoch_now)
T_UPLOAD_SECS=$((T_UPLOAD_END - T_UPLOAD_START))

if ! $DRY_RUN; then
  # Verify all uploads landed
  UPLOAD_COUNT=$(${AWS} s3 ls "${S3_URI}/${PREFIX}/" --recursive | wc -l | tr -d ' ')
  if [ "$UPLOAD_COUNT" -ge 7 ]; then
    pass "All files visible in S3 (${UPLOAD_COUNT} objects, upload ${T_UPLOAD_SECS}s)"
  else
    fail "Expected >= 7 objects in S3, found ${UPLOAD_COUNT}"
  fi
fi

###############################################################################
# Dry-run: validate generated data locally and exit early
###############################################################################
if $DRY_RUN; then
  echo ""
  echo "--- Dry-run: validating generated JSON ---"

  for jf in metadata.json clicks.json transcript.json; do
    if python3 -m json.tool "${TMP}/${jf}" >/dev/null 2>&1; then
      pass "${jf} is valid JSON"
    else
      fail "${jf} is invalid JSON"
    fi
  done

  # Validate metadata required fields
  for field in session_id visitor_name started_at ended_at status upload_complete; do
    HAS=$(python3 -c "
import json, sys
d = json.load(open('${TMP}/metadata.json'))
v = d.get('${field}')
print('yes' if v is not None and v != '' else 'no')
" 2>/dev/null || echo "error")
    if [ "$HAS" = "yes" ]; then
      pass "metadata.json field '${field}' present"
    else
      fail "metadata.json field '${field}' missing"
    fi
  done

  # Validate clicks structure
  CLICK_COUNT=$(python3 -c "import json; print(len(json.load(open('${TMP}/clicks.json')).get('events',[])))" 2>/dev/null || echo "0")
  if [ "$CLICK_COUNT" -ge 1 ]; then
    pass "clicks.json has ${CLICK_COUNT} events"
  else
    fail "clicks.json has no events"
  fi

  # Validate transcript structure
  ENTRY_COUNT=$(python3 -c "import json; print(len(json.load(open('${TMP}/transcript.json')).get('entries',[])))" 2>/dev/null || echo "0")
  if [ "$ENTRY_COUNT" -ge 1 ]; then
    pass "transcript.json has ${ENTRY_COUNT} entries"
  else
    fail "transcript.json has no entries"
  fi

  # Check screenshots are valid JPEG (FF D8 magic bytes)
  for jpg in "${TMP}"/click-*.jpg; do
    MAGIC=$(xxd -l 2 -p "$jpg" 2>/dev/null || od -A n -t x1 -N 2 "$jpg" 2>/dev/null | tr -d ' ')
    if [ "$MAGIC" = "ffd8" ]; then
      pass "$(basename "$jpg") has valid JPEG header"
    else
      fail "$(basename "$jpg") is not a valid JPEG (got: ${MAGIC})"
    fi
  done

  echo ""
  echo "=============================================="
  echo " Dry Run Results"
  echo "   PASS: ${PASS}"
  echo "   FAIL: ${FAIL}"
  echo "=============================================="
  if [ "$FAIL" -gt 0 ]; then
    echo "   *** ${FAIL} check(s) FAILED ***"
    exit 1
  fi
  echo "   All generated data is valid. Ready for live run."
  exit 0
fi

###############################################################################
# Step 2: Trigger analysis pipeline (poll for watcher output)
###############################################################################
echo ""
echo "--- Step 2: Waiting for pipeline output (timeout: ${POLL_TIMEOUT}s) ---"
echo "  Polling for ${S3_URI}/${PREFIX}/output/summary.json ..."

T_POLL_START=$(epoch_now)
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

T_POLL_END=$(epoch_now)
T_PIPELINE_SECS=$((T_POLL_END - T_POLL_START))

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
# Step 3: Validate output structure and content -- summary.json
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

# Required fields (per DATA-CONTRACT.md)
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

# Deep validation: key_interests is array of objects with topic + confidence
KI_DEEP=$(python3 -c "
import json
d = json.load(open('${TMP}/summary.json'))
ki = d.get('key_interests', [])
if not isinstance(ki, list) or len(ki) == 0:
    print('empty')
else:
    ok = all(isinstance(i, dict) and i.get('topic') and i.get('confidence') for i in ki)
    print('ok:' + str(len(ki)) if ok else 'bad_structure')
" 2>/dev/null || echo "error")

case "$KI_DEEP" in
  ok:*)
    pass "key_interests has ${KI_DEEP#ok:} entries, each with topic + confidence"
    ;;
  empty)
    fail "key_interests is empty or not an array"
    ;;
  bad_structure)
    fail "key_interests entries missing required topic/confidence fields"
    ;;
  *)
    fail "key_interests deep validation error: ${KI_DEEP}"
    ;;
esac

# Deep validation: follow_up_actions is array of actionable strings
FA_DEEP=$(python3 -c "
import json
d = json.load(open('${TMP}/summary.json'))
fa = d.get('follow_up_actions', [])
if not isinstance(fa, list) or len(fa) == 0:
    print('empty')
elif all(isinstance(a, str) and len(a) > 5 for a in fa):
    print('ok:' + str(len(fa)))
else:
    print('bad_items')
" 2>/dev/null || echo "error")

case "$FA_DEEP" in
  ok:*)
    pass "follow_up_actions has ${FA_DEEP#ok:} actionable strings"
    ;;
  empty)
    fail "follow_up_actions is empty or not an array"
    ;;
  bad_items)
    fail "follow_up_actions contains non-string or trivially short items"
    ;;
  *)
    fail "follow_up_actions deep validation error: ${FA_DEEP}"
    ;;
esac

# executive_summary is substantive (>20 chars)
ES_LEN=$(python3 -c "
import json
print(len(json.load(open('${TMP}/summary.json')).get('executive_summary', '')))
" 2>/dev/null || echo "0")

if [ "$ES_LEN" -gt 20 ]; then
  pass "executive_summary is substantive (${ES_LEN} chars)"
else
  fail "executive_summary too short (${ES_LEN} chars, need >20)"
fi

###############################################################################
# Step 4: Validate summary.html
###############################################################################
echo ""
echo "--- Step 4: Checking HTML report ---"

if ${AWS} s3 ls "${S3_URI}/${PREFIX}/output/summary.html" >/dev/null 2>&1; then
  pass "output/summary.html exists"

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
# Step 5: Check follow-up.json and optional outputs
###############################################################################
echo ""
echo "--- Step 5: Checking follow-up.json and optional outputs ---"

if ${AWS} s3 ls "${S3_URI}/${PREFIX}/output/follow-up.json" >/dev/null 2>&1; then
  pass "output/follow-up.json exists"

  ${AWS} s3 cp "${S3_URI}/${PREFIX}/output/follow-up.json" "${TMP}/follow-up.json" --quiet
  if python3 -c "import json; json.load(open('${TMP}/follow-up.json'))" 2>/dev/null; then
    pass "follow-up.json is valid JSON"
  else
    fail "follow-up.json is not valid JSON"
  fi

  # Validate follow-up.json has session_id
  FU_SID=$(python3 -c "import json; print(json.load(open('${TMP}/follow-up.json')).get('session_id',''))" 2>/dev/null || echo "")
  if [ "$FU_SID" = "$SESSION_ID" ]; then
    pass "follow-up.json session_id matches"
  else
    fail "follow-up.json session_id mismatch: expected '${SESSION_ID}', got '${FU_SID}'"
  fi
else
  echo "  [INFO] output/follow-up.json not found (may not be generated by all pipeline versions)"
fi

# Informational: other optional outputs
for file in "output/timeline.json" "output/follow-up-email.html" "output/.analysis-claimed"; do
  if ${AWS} s3 ls "${S3_URI}/${PREFIX}/${file}" >/dev/null 2>&1; then
    echo "  [INFO] ${file} exists"
  else
    echo "  [INFO] ${file} not found (optional)"
  fi
done

###############################################################################
# Results with timing breakdown
###############################################################################
T_TOTAL_END=$(epoch_now)
T_TOTAL_SECS=$((T_TOTAL_END - T_UPLOAD_START))

echo ""
echo "=============================================="
echo " E2E Pipeline Test Results"
echo "   PASS: ${PASS}"
echo "   FAIL: ${FAIL}"
echo "   Session: ${SESSION_ID}"
echo "----------------------------------------------"
echo " Timing"
echo "   Upload:           ${T_UPLOAD_SECS}s"
echo "   Pipeline (poll):  ${T_PIPELINE_SECS}s"
echo "   Total:            ${T_TOTAL_SECS}s"
echo "=============================================="

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "   *** ${FAIL} check(s) FAILED ***"
  exit 1
fi

echo ""
echo "   All checks passed -- full pipeline is working."
exit 0
