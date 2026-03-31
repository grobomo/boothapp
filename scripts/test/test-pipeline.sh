#!/usr/bin/env bash
# test-pipeline.sh -- End-to-end test for the boothapp analysis pipeline.
# Uploads a synthetic session to S3, waits for the pipeline to produce
# output/summary.json, validates required fields, and cleans up.
# Exit 0 = pass, Exit 1 = fail.

set -euo pipefail

BUCKET="${BOOTH_S3_BUCKET:-boothapp-sessions-752266476357}"
REGION="${AWS_REGION:-us-east-1}"
POLL_INTERVAL=10
MAX_WAIT=180  # 3 minutes
SESSION_ID="E2E-TEST-$(date +%s)-$$"
S3_PREFIX="sessions/${SESSION_ID}"
TMPDIR_TEST=$(mktemp -d)

# Build AWS CLI args -- add --profile only if AWS_PROFILE is set
AWS_ARGS=(--region "$REGION")
if [ -n "${AWS_PROFILE:-}" ]; then
  AWS_ARGS+=(--profile "$AWS_PROFILE")
fi

# ── Helpers ─────────────────────────────────────

green() { printf '\033[32m  PASS\033[0m %s\n' "$1"; }
red()   { printf '\033[31m  FAIL\033[0m %s\n' "$1"; }
info()  { printf '\033[36m  INFO\033[0m %s\n' "$1"; }

cleanup() {
  info "Cleaning up S3 test data for ${SESSION_ID}..."
  aws s3 rm "s3://${BUCKET}/${S3_PREFIX}/" \
    --recursive "${AWS_ARGS[@]}" >/dev/null 2>&1 || true
  rm -rf "$TMPDIR_TEST" 2>/dev/null || true
  info "Cleanup complete."
}

trap cleanup EXIT

die() {
  red "$1"
  exit 1
}

upload_json() {
  local key="$1"
  local body="$2"
  local full_key="${S3_PREFIX}/${key}"
  local tmpfile="${TMPDIR_TEST}/$(echo "$key" | tr '/' '_')"
  echo "$body" > "$tmpfile"
  aws s3api put-object \
    --bucket "$BUCKET" \
    --key "$full_key" \
    --body "$tmpfile" \
    --content-type "application/json" \
    "${AWS_ARGS[@]}" >/dev/null 2>&1
}

# ── Banner ──────────────────────────────────────

echo "============================================"
echo "  BoothApp E2E Pipeline Test"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Session: ${SESSION_ID}"
echo "  Bucket:  ${BUCKET}"
echo "============================================"
echo ""

# ── Step 1: Generate and upload test data ───────

info "Uploading test session data..."

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STARTED=$(date -u -d '20 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-20M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$NOW")

METADATA=$(cat <<ENDJSON
{
  "session_id": "${SESSION_ID}",
  "visitor_name": "E2E Test Visitor",
  "visitor_company": "TestCorp International",
  "visitor_title": "Director of Security",
  "started_at": "${STARTED}",
  "ended_at": "${NOW}",
  "demo_pc": "e2e-test-pc",
  "se_name": "E2E Bot",
  "audio_consent": true,
  "status": "completed"
}
ENDJSON
)

CLICKS=$(cat <<'ENDJSON'
{
  "session_id": "SESSION_ID_PLACEHOLDER",
  "events": [
    {
      "index": 1, "timestamp": "2026-01-01T10:01:00Z", "type": "click",
      "dom_path": "div.app > nav > a.dashboard",
      "element": {"tag": "a", "class": "dashboard", "text": "Dashboard", "href": "/dashboard"},
      "coordinates": {"x": 120, "y": 45},
      "page_url": "https://portal.xdr.trendmicro.com/app/dashboard",
      "page_title": "Vision One - Executive Dashboard",
      "screenshot_file": "screenshots/click-001.jpg"
    },
    {
      "index": 2, "timestamp": "2026-01-01T10:03:00Z", "type": "click",
      "dom_path": "div.app > nav > a.xdr",
      "element": {"tag": "a", "class": "xdr", "text": "XDR Detection", "href": "/xdr"},
      "coordinates": {"x": 120, "y": 180},
      "page_url": "https://portal.xdr.trendmicro.com/app/xdr",
      "page_title": "Vision One - XDR Detection & Response",
      "screenshot_file": "screenshots/click-002.jpg"
    },
    {
      "index": 3, "timestamp": "2026-01-01T10:06:00Z", "type": "click",
      "dom_path": "div.app > nav > a.endpoint",
      "element": {"tag": "a", "class": "endpoint", "text": "Endpoint Security", "href": "/endpoint"},
      "coordinates": {"x": 120, "y": 260},
      "page_url": "https://portal.xdr.trendmicro.com/app/endpoint",
      "page_title": "Vision One - Endpoint Security",
      "screenshot_file": "screenshots/click-003.jpg"
    }
  ]
}
ENDJSON
)
CLICKS="${CLICKS//SESSION_ID_PLACEHOLDER/$SESSION_ID}"

TRANSCRIPT=$(cat <<ENDJSON
{
  "session_id": "${SESSION_ID}",
  "source": "recording.wav",
  "duration_seconds": 600,
  "entries": [
    {"timestamp": "00:00:05.000", "speaker": "SE", "text": "Welcome to the Trend Micro booth. Let me show you Vision One."},
    {"timestamp": "00:00:15.000", "speaker": "Visitor", "text": "We are evaluating XDR platforms to replace our current SIEM."},
    {"timestamp": "00:01:00.000", "speaker": "SE", "text": "Let me start with the executive dashboard. This gives you risk visibility across your entire environment."},
    {"timestamp": "00:02:00.000", "speaker": "Visitor", "text": "How does XDR detection work? Can it correlate across email and endpoint?"},
    {"timestamp": "00:02:30.000", "speaker": "SE", "text": "Absolutely. Vision One correlates detections across endpoint, email, network, and cloud in one workbench."},
    {"timestamp": "00:04:00.000", "speaker": "SE", "text": "Now let me show you endpoint security. You can manage policies and see agent status here."},
    {"timestamp": "00:05:00.000", "speaker": "Visitor", "text": "This looks very comprehensive. We would like to set up a proof of concept."},
    {"timestamp": "00:05:30.000", "speaker": "SE", "text": "We can arrange a 30-day POC. Let me get your details."}
  ]
}
ENDJSON
)

upload_json "metadata.json" "$METADATA" || die "Failed to upload metadata.json"
green "Uploaded metadata.json"

upload_json "clicks/clicks.json" "$CLICKS" || die "Failed to upload clicks.json"
green "Uploaded clicks/clicks.json"

upload_json "transcript/transcript.json" "$TRANSCRIPT" || die "Failed to upload transcript.json"
green "Uploaded transcript/transcript.json"

# ── Step 2: Wait for pipeline output ────────────

echo ""
info "Waiting up to ${MAX_WAIT}s for output/summary.json..."

SUMMARY_KEY="${S3_PREFIX}/output/summary.json"
ELAPSED=0

while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  if aws s3api head-object \
    --bucket "$BUCKET" \
    --key "$SUMMARY_KEY" \
    "${AWS_ARGS[@]}" >/dev/null 2>&1; then
    green "summary.json appeared after ${ELAPSED}s"
    break
  fi

  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
  printf '\r  ...  %ds / %ds' "$ELAPSED" "$MAX_WAIT"
done

echo ""

if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
  die "Timed out after ${MAX_WAIT}s waiting for summary.json"
fi

# ── Step 3: Validate summary.json fields ────────

info "Downloading and validating summary.json..."

SUMMARY_FILE="${TMPDIR_TEST}/summary.json"
aws s3api get-object \
  --bucket "$BUCKET" \
  --key "$SUMMARY_KEY" \
  "${AWS_ARGS[@]}" \
  "$SUMMARY_FILE" >/dev/null 2>&1 || die "Failed to download summary.json"
SUMMARY=$(cat "$SUMMARY_FILE")

# Check if this is a fallback (non-AI) summary
IS_FALLBACK=$(echo "$SUMMARY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('yes' if d.get('fallback') else 'no')
" 2>/dev/null || echo "unknown")

if [ "$IS_FALLBACK" = "yes" ]; then
  printf '\033[33m  WARN\033[0m summary.json is a fallback (AI analysis unavailable)\n'
fi

# Validate session_id matches what we uploaded
SUMMARY_SID=$(echo "$SUMMARY" | python3 -c "
import sys, json
print(json.load(sys.stdin).get('session_id', ''))
" 2>/dev/null || true)

if [ "$SUMMARY_SID" != "$SESSION_ID" ]; then
  die "session_id mismatch: expected '${SESSION_ID}', got '${SUMMARY_SID}'"
fi
green "session_id matches"

# Validate visitor_name exists and is non-empty
VISITOR_NAME=$(echo "$SUMMARY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
v = d.get('visitor_name', '')
print(v if v else '')
" 2>/dev/null || true)

if [ -z "$VISITOR_NAME" ]; then
  die "summary.json missing or empty 'visitor_name' field"
fi
green "visitor_name = '${VISITOR_NAME}'"

# Validate products_shown (or products_demonstrated in fallback) exists and is an array
PRODUCTS_RESULT=$(echo "$SUMMARY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
# Accept either field name -- AI summary uses 'products_shown', fallback uses 'products_demonstrated'
p = d.get('products_shown') or d.get('products_demonstrated')
if not isinstance(p, list):
    print('MISSING')
else:
    print(len(p))
" 2>/dev/null || echo "MISSING")

if [ "$PRODUCTS_RESULT" = "MISSING" ]; then
  die "summary.json missing 'products_shown' (or 'products_demonstrated') field"
fi
green "products_shown has ${PRODUCTS_RESULT} item(s)"

# ── Summary ─────────────────────────────────────

echo ""
echo "============================================"
printf '  \033[32mE2E PIPELINE TEST PASSED\033[0m\n'
echo "  Session: ${SESSION_ID}"
echo "  visitor_name: ${VISITOR_NAME}"
echo "  products_shown: ${PRODUCTS_RESULT} product(s)"
echo "============================================"

exit 0
