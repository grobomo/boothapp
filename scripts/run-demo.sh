#!/usr/bin/env bash
#
# run-demo.sh -- End-to-end BoothApp demo
#
# Creates a session in S3, uploads sample data, waits for the analysis
# pipeline to process it, then opens the HTML report.
#
# Usage:
#   AWS_PROFILE=hackathon S3_BUCKET=boothapp-sessions-752266476357 bash scripts/run-demo.sh
#
# Environment:
#   AWS_PROFILE   -- AWS CLI profile to use (required)
#   S3_BUCKET     -- S3 bucket name (required)
#   POLL_TIMEOUT  -- Max seconds to wait for processing (default: 120)
#   POLL_INTERVAL -- Seconds between polls (default: 5)

set -euo pipefail

# -------------------------------------------------------------------
# Config
# -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DATA="$PROJECT_DIR/test-data"

POLL_TIMEOUT="${POLL_TIMEOUT:-120}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"

# -------------------------------------------------------------------
# Validation
# -------------------------------------------------------------------
if [[ -z "${AWS_PROFILE:-}" ]]; then
    echo "ERROR: AWS_PROFILE is not set."
    echo "  export AWS_PROFILE=hackathon"
    exit 1
fi

if [[ -z "${S3_BUCKET:-}" ]]; then
    echo "ERROR: S3_BUCKET is not set."
    echo "  export S3_BUCKET=boothapp-sessions-752266476357"
    exit 1
fi

if ! command -v aws &>/dev/null; then
    echo "ERROR: AWS CLI not found. Install it first."
    exit 1
fi

# Verify AWS credentials work
if ! aws sts get-caller-identity --profile "$AWS_PROFILE" &>/dev/null; then
    echo "ERROR: AWS credentials invalid for profile '$AWS_PROFILE'."
    echo "  Run: aws configure --profile $AWS_PROFILE"
    exit 1
fi

# Verify test data exists
for f in clicks.json badge.json transcript.txt; do
    if [[ ! -f "$TEST_DATA/$f" ]]; then
        echo "ERROR: Missing test data file: test-data/$f"
        exit 1
    fi
done

# -------------------------------------------------------------------
# Create session
# -------------------------------------------------------------------
SESSION_ID="demo-$(date +%Y%m%d-%H%M%S)-$$"
S3_PREFIX="sessions/$SESSION_ID"

echo "========================================"
echo "  BoothApp Demo Runner"
echo "========================================"
echo ""
echo "  Profile:  $AWS_PROFILE"
echo "  Bucket:   $S3_BUCKET"
echo "  Session:  $SESSION_ID"
echo "  S3 path:  s3://$S3_BUCKET/$S3_PREFIX/"
echo ""

# -------------------------------------------------------------------
# Upload session data
# -------------------------------------------------------------------
echo "[1/4] Uploading session data..."

echo "  -> clicks.json"
aws s3 cp "$TEST_DATA/clicks.json" \
    "s3://$S3_BUCKET/$S3_PREFIX/clicks.json" \
    --profile "$AWS_PROFILE" --quiet

echo "  -> badge.json"
aws s3 cp "$TEST_DATA/badge.json" \
    "s3://$S3_BUCKET/$S3_PREFIX/badge.json" \
    --profile "$AWS_PROFILE" --quiet

echo "  -> transcript.txt"
aws s3 cp "$TEST_DATA/transcript.txt" \
    "s3://$S3_BUCKET/$S3_PREFIX/transcript.txt" \
    --profile "$AWS_PROFILE" --quiet

# Upload ready trigger LAST (per S3 data contract)
echo "  -> ready (trigger)"
echo -n "" | aws s3 cp - \
    "s3://$S3_BUCKET/$S3_PREFIX/ready" \
    --profile "$AWS_PROFILE" --quiet

echo "  Done. Session data uploaded."
echo ""

# -------------------------------------------------------------------
# Poll for processing output
# -------------------------------------------------------------------
echo "[2/4] Waiting for analysis pipeline..."
echo "  Polling s3://$S3_BUCKET/$S3_PREFIX/output/report.html"
echo "  Timeout: ${POLL_TIMEOUT}s (poll every ${POLL_INTERVAL}s)"
echo ""

ELAPSED=0
PROCESSED=false

while [[ $ELAPSED -lt $POLL_TIMEOUT ]]; do
    # Check for report.html (success) or error.json (failure)
    if aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/output/report.html" \
        --profile "$AWS_PROFILE" &>/dev/null; then
        PROCESSED=true
        break
    fi

    if aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/output/error.json" \
        --profile "$AWS_PROFILE" &>/dev/null; then
        echo "  ERROR: Pipeline failed. Downloading error details..."
        aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/output/error.json" /tmp/boothapp-error.json \
            --profile "$AWS_PROFILE" --quiet
        echo ""
        cat /tmp/boothapp-error.json
        echo ""
        exit 1
    fi

    printf "  Waiting... %3ds / %ds\r" "$ELAPSED" "$POLL_TIMEOUT"
    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

# -------------------------------------------------------------------
# Handle timeout with local fallback
# -------------------------------------------------------------------
if [[ "$PROCESSED" != "true" ]]; then
    echo ""
    echo "  TIMEOUT: No output after ${POLL_TIMEOUT}s."
    echo ""
    echo "  The watcher may not be running. Start it with:"
    echo "    npm run watcher"
    echo ""
    echo "  Or check the session manually:"
    echo "    aws s3 ls s3://$S3_BUCKET/$S3_PREFIX/ --recursive --profile $AWS_PROFILE"
    echo ""

    # Generate a local report from sample data as fallback
    echo "  Generating local report from sample data as fallback..."
    if command -v python3 &>/dev/null && [[ -f "$PROJECT_DIR/examples/generate_sample.py" ]]; then
        (cd "$PROJECT_DIR" && python3 examples/generate_sample.py)
        REPORT_PATH="$PROJECT_DIR/examples/sample_report.html"
        echo "  Local report generated at: $REPORT_PATH"
    else
        echo "  Cannot generate local report (python3 or generate_sample.py not found)."
        echo "  Session data is in S3 -- run the watcher to process it."
        exit 1
    fi
else
    echo "  Processing complete!"
    echo ""

    # -------------------------------------------------------------------
    # Download report
    # -------------------------------------------------------------------
    echo "[3/4] Downloading report..."
    REPORT_DIR="/tmp/boothapp-demo-$SESSION_ID"
    mkdir -p "$REPORT_DIR"
    REPORT_PATH="$REPORT_DIR/report.html"

    aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/output/report.html" "$REPORT_PATH" \
        --profile "$AWS_PROFILE" --quiet

    # Also grab follow-up email and result.json if they exist
    aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/output/follow-up-email.html" \
        "$REPORT_DIR/follow-up-email.html" \
        --profile "$AWS_PROFILE" --quiet 2>/dev/null || true

    aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/output/result.json" \
        "$REPORT_DIR/result.json" \
        --profile "$AWS_PROFILE" --quiet 2>/dev/null || true

    echo "  Downloaded to: $REPORT_DIR/"
fi

# -------------------------------------------------------------------
# Open report in browser
# -------------------------------------------------------------------
echo ""
echo "[4/4] Opening report..."

if [[ -f "$REPORT_PATH" ]]; then
    if command -v xdg-open &>/dev/null; then
        xdg-open "$REPORT_PATH" 2>/dev/null &
    elif command -v open &>/dev/null; then
        open "$REPORT_PATH"
    elif command -v start &>/dev/null; then
        start "" "$REPORT_PATH"
    else
        echo "  Could not detect browser opener. Open manually:"
        echo "  $REPORT_PATH"
    fi
fi

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
echo ""
echo "========================================"
echo "  Demo Complete"
echo "========================================"
echo ""
echo "  Session ID:   $SESSION_ID"
echo "  S3 location:  s3://$S3_BUCKET/$S3_PREFIX/"
echo "  Report:       $REPORT_PATH"
echo ""
echo "  Uploaded files:"
echo "    - clicks.json    (5 click events)"
echo "    - badge.json     (visitor: Alex Rivera, Globex Industries)"
echo "    - transcript.txt (1m23s demo conversation)"
echo "    - ready          (trigger file)"
echo ""
if [[ "$PROCESSED" == "true" ]]; then
    echo "  Pipeline output:"
    echo "    - report.html"
    if [[ -d "$REPORT_DIR" ]]; then
        ls "$REPORT_DIR"/ 2>/dev/null | grep -v report.html | sed 's/^/    - /'
    fi
else
    echo "  NOTE: Pipeline did not process within timeout."
    echo "  A local sample report was generated instead."
fi
echo ""
echo "  To re-run:  AWS_PROFILE=$AWS_PROFILE S3_BUCKET=$S3_BUCKET bash scripts/run-demo.sh"
echo "  To clean:   aws s3 rm s3://$S3_BUCKET/$S3_PREFIX/ --recursive --profile $AWS_PROFILE"
echo ""
