#!/usr/bin/env bash
# ===========================================================================
#  BoothApp -- Demo-Day Preflight Validation
#
#  Runs 8 checks to confirm the entire system is operational before showtime.
#  Exit 0 only if every check passes.
# ===========================================================================
set -euo pipefail

# ── Colours & symbols ─────────────────────────────────────────────
RED='\033[1;31m'
GRN='\033[1;32m'
YEL='\033[1;33m'
CYN='\033[1;36m'
RST='\033[0m'

PASS_BANNER="${GRN}
  ########     ###     ######   ######
  ##     ##   ## ##   ##    ## ##    ##
  ##     ##  ##   ##  ##       ##
  ########  ##     ##  ######   ######
  ##        #########       ##       ##
  ##        ##     ## ##    ## ##    ##
  ##        ##     ##  ######   ######
${RST}"

FAIL_BANNER="${RED}
  ########    ###    #### ##
  ##         ## ##    ##  ##
  ##        ##   ##   ##  ##
  ######   ##     ##  ##  ##
  ##       #########  ##  ##
  ##       ##     ##  ##  ##
  ##       ##     ## #### ########
${RST}"

# ── Counters ──────────────────────────────────────────────────────
TOTAL=0
PASSED=0
FAILED=0
RESULTS=()

pass() {
    TOTAL=$((TOTAL + 1))
    PASSED=$((PASSED + 1))
    RESULTS+=("${GRN}[PASS]${RST} $1")
    echo -e "  ${GRN}[PASS]${RST} $1"
}

fail() {
    TOTAL=$((TOTAL + 1))
    FAILED=$((FAILED + 1))
    RESULTS+=("${RED}[FAIL]${RST} $1 -- $2")
    echo -e "  ${RED}[FAIL]${RST} $1 -- $2"
}

header() {
    echo ""
    echo -e "  ${CYN}[$1]${RST} $2"
    echo -e "  ${CYN}$(printf '%.0s─' $(seq 1 60))${RST}"
}

# ── Resolve project root (script lives in scripts/) ──────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo -e "${CYN}=================================================================${RST}"
echo -e "${CYN}  BoothApp -- Demo-Day Preflight Validation${RST}"
echo -e "${CYN}  $(date '+%Y-%m-%d %H:%M:%S')${RST}"
echo -e "${CYN}=================================================================${RST}"

# ======================================================================
# 1. Environment Variables
# ======================================================================
header "1/8" "Environment Variables"

REQUIRED_VARS=(
    AWS_PROFILE
    AWS_REGION
    BOOTH_S3_BUCKET
)

ENV_OK=true
MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        ENV_OK=false
        MISSING_VARS+=("$var")
    fi
done

if $ENV_OK; then
    pass "All required env vars set (${REQUIRED_VARS[*]})"
else
    fail "Environment variables" "missing: ${MISSING_VARS[*]}"
fi

# ======================================================================
# 2. S3 Bucket Accessible + Correct Structure
# ======================================================================
header "2/8" "S3 Bucket"

if [[ -z "${BOOTH_S3_BUCKET:-}" ]]; then
    fail "S3 bucket" "BOOTH_S3_BUCKET not set, cannot check"
else
    # Can we reach the bucket at all?
    if aws s3 ls "s3://${BOOTH_S3_BUCKET}/" --profile "${AWS_PROFILE:-default}" --region "${AWS_REGION:-us-east-1}" >/dev/null 2>&1; then
        # Check for sessions/ prefix
        SESSION_COUNT=$(aws s3 ls "s3://${BOOTH_S3_BUCKET}/sessions/" --profile "${AWS_PROFILE:-default}" --region "${AWS_REGION:-us-east-1}" 2>/dev/null | wc -l)
        SESSION_COUNT="${SESSION_COUNT:-0}"
        if [[ "$SESSION_COUNT" -gt 0 ]]; then
            pass "S3 bucket accessible, sessions/ prefix exists (${SESSION_COUNT} entries)"
        else
            fail "S3 bucket" "bucket accessible but sessions/ prefix is empty or missing"
        fi
    else
        fail "S3 bucket" "cannot access s3://${BOOTH_S3_BUCKET}/"
    fi
fi

# ======================================================================
# 3. Lambda Function Exists & Invocable
# ======================================================================
header "3/8" "Lambda (Pre-signed URL)"

LAMBDA_NAME="${BOOTH_LAMBDA_NAME:-boothapp-presign}"

if aws lambda get-function --function-name "$LAMBDA_NAME" \
    --profile "${AWS_PROFILE:-default}" \
    --region "${AWS_REGION:-us-east-1}" >/dev/null 2>&1; then

    # Dry-invoke to confirm it can execute
    INVOKE_OUT=$(aws lambda invoke \
        --function-name "$LAMBDA_NAME" \
        --profile "${AWS_PROFILE:-default}" \
        --region "${AWS_REGION:-us-east-1}" \
        --payload '{"httpMethod":"GET","path":"/health"}' \
        --cli-binary-format raw-in-base64-out \
        /tmp/boothapp-lambda-test.json 2>&1) || true

    if [[ -f /tmp/boothapp-lambda-test.json ]]; then
        STATUS=$(grep -o '"StatusCode":[0-9]*' <<< "$INVOKE_OUT" || echo "")
        pass "Lambda '${LAMBDA_NAME}' exists and invocable"
        rm -f /tmp/boothapp-lambda-test.json
    else
        fail "Lambda" "'${LAMBDA_NAME}' exists but invocation failed"
    fi
else
    fail "Lambda" "function '${LAMBDA_NAME}' not found"
fi

# ======================================================================
# 4. Watcher Running + Health Endpoint
# ======================================================================
header "4/8" "Analysis Watcher"

WATCHER_URL="${BOOTH_WATCHER_URL:-http://localhost:3000/health}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$WATCHER_URL" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Watcher responding at ${WATCHER_URL}"
else
    fail "Watcher" "health endpoint returned HTTP ${HTTP_CODE} (expected 200) at ${WATCHER_URL}"
fi

# ======================================================================
# 5. Chrome Extension Files Valid
# ======================================================================
header "5/8" "Chrome Extension"

EXT_DIR="${PROJECT_ROOT}/extension"
MANIFEST="${EXT_DIR}/manifest.json"

if [[ -f "$MANIFEST" ]]; then
    # Is manifest.json valid JSON?
    if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$MANIFEST" 2>/dev/null \
       || node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$MANIFEST" 2>/dev/null; then

        # Check required permissions
        PERMS=$(python3 -c "
import json,sys
m = json.load(open(sys.argv[1]))
perms = m.get('permissions', []) + m.get('optional_permissions', [])
print(' '.join(perms))
" "$MANIFEST" 2>/dev/null || node -e "
const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
const p=(m.permissions||[]).concat(m.optional_permissions||[]);
console.log(p.join(' '));
" "$MANIFEST" 2>/dev/null || echo "")

        MISSING_PERMS=()
        for perm in tabCapture activeTab storage; do
            if ! echo "$PERMS" | grep -qw "$perm"; then
                MISSING_PERMS+=("$perm")
            fi
        done

        if [[ ${#MISSING_PERMS[@]} -eq 0 ]]; then
            pass "manifest.json valid, required permissions present"
        else
            fail "Chrome extension" "missing permissions: ${MISSING_PERMS[*]}"
        fi
    else
        fail "Chrome extension" "manifest.json is not valid JSON"
    fi
else
    fail "Chrome extension" "manifest.json not found at ${MANIFEST}"
fi

# ======================================================================
# 6. Audio Recorder Script Exists
# ======================================================================
header "6/8" "Audio Recorder"

# The audio recorder is part of the Chrome extension content/background scripts
RECORDER_CANDIDATES=(
    "${EXT_DIR}/background.js"
    "${EXT_DIR}/recorder.js"
    "${EXT_DIR}/content.js"
    "${EXT_DIR}/src/recorder.js"
    "${EXT_DIR}/src/background.js"
)

RECORDER_FOUND=false
for candidate in "${RECORDER_CANDIDATES[@]}"; do
    if [[ -f "$candidate" ]]; then
        RECORDER_FOUND=true
        pass "Audio recorder found at $(basename "$candidate")"
        break
    fi
done

if ! $RECORDER_FOUND; then
    fail "Audio recorder" "no recorder script found in extension/"
fi

# ======================================================================
# 7. Sample Session with Complete Analysis
# ======================================================================
header "7/8" "Sample Sessions"

if [[ -z "${BOOTH_S3_BUCKET:-}" ]]; then
    fail "Sample sessions" "BOOTH_S3_BUCKET not set, cannot check"
else
    # Find sessions that have output/result.json (complete analysis)
    COMPLETE_SESSIONS=$(aws s3 ls "s3://${BOOTH_S3_BUCKET}/sessions/" \
        --profile "${AWS_PROFILE:-default}" \
        --region "${AWS_REGION:-us-east-1}" \
        --recursive 2>/dev/null \
        | grep -c "output/result\.json" 2>/dev/null || true)
    COMPLETE_SESSIONS="${COMPLETE_SESSIONS:-0}"

    if [[ "$COMPLETE_SESSIONS" -gt 0 ]]; then
        pass "Found ${COMPLETE_SESSIONS} session(s) with complete analysis"
    else
        fail "Sample sessions" "no sessions found with output/result.json"
    fi
fi

# ======================================================================
# 8. Presenter Pages Load
# ======================================================================
header "8/8" "Presenter Pages"

PRESENTER_BASE="${BOOTH_PRESENTER_URL:-http://localhost:8080}"
PAGES=(
    "/"
    "/demo.html"
)

PAGE_OK=true
PAGE_FAILS=()
for page in "${PAGES[@]}"; do
    URL="${PRESENTER_BASE}${page}"
    CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL" 2>/dev/null || echo "000")
    if [[ "$CODE" != "200" ]]; then
        PAGE_OK=false
        PAGE_FAILS+=("${page}(${CODE})")
    fi
done

if $PAGE_OK; then
    pass "All presenter pages return HTTP 200"
else
    fail "Presenter pages" "failed: ${PAGE_FAILS[*]}"
fi

# ======================================================================
# Summary
# ======================================================================
echo ""
echo -e "${CYN}=================================================================${RST}"
echo -e "${CYN}  RESULTS: ${PASSED}/${TOTAL} passed, ${FAILED} failed${RST}"
echo -e "${CYN}=================================================================${RST}"
echo ""

for r in "${RESULTS[@]}"; do
    echo -e "  $r"
done

echo ""

if [[ "$FAILED" -eq 0 ]]; then
    echo -e "$PASS_BANNER"
    echo -e "  ${GRN}All systems go. Ready for demo day.${RST}"
    echo ""
    exit 0
else
    echo -e "$FAIL_BANNER"
    echo -e "  ${RED}${FAILED} check(s) failed. Fix before demo day.${RST}"
    echo ""
    exit 1
fi
