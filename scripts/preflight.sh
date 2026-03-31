#!/usr/bin/env bash
# preflight.sh -- Automated demo preflight checker for BoothApp
# Verifies every component before demo day.
# Exit 0 = all pass, Exit 1 = any fail.

set -euo pipefail

PASS=0
FAIL=0
PROFILE="${AWS_PROFILE:-hackathon}"
BUCKET="${BOOTH_S3_BUCKET:-boothapp-recordings}"
LAMBDA="${BOOTH_LAMBDA_NAME:-boothapp-analyzer}"
EXTENSION_DIR="${BOOTH_EXTENSION_DIR:-extension}"

green() { printf '\033[32m  PASS\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
red()   { printf '\033[31m  FAIL\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    green "$label"
  else
    red "$label"
  fi
}

echo "============================================"
echo "  BoothApp Preflight Check"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

# ── 1. AWS CLI configured ──────────────────────
echo "[1/9] AWS CLI"
if aws sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1; then
  IDENTITY=$(aws sts get-caller-identity --profile "$PROFILE" --output text --query 'Account' 2>/dev/null)
  green "AWS CLI configured (account: $IDENTITY)"
else
  red "AWS CLI not configured (profile: $PROFILE)"
fi

# ── 2. S3 bucket accessible (put+get+delete) ───
echo "[2/9] S3 Bucket"
TEST_KEY="preflight-test-$(date +%s).txt"
TEST_BODY="preflight-check"
S3_OK=true

if ! aws s3api put-object --bucket "$BUCKET" --key "$TEST_KEY" --body <(echo "$TEST_BODY") --profile "$PROFILE" >/dev/null 2>&1; then
  red "S3 put-object to s3://$BUCKET"
  S3_OK=false
fi

if $S3_OK; then
  GOT=$(aws s3api get-object --bucket "$BUCKET" --key "$TEST_KEY" --profile "$PROFILE" /dev/stdout 2>/dev/null | head -1)
  if [ "$GOT" = "$TEST_BODY" ]; then
    green "S3 put+get verified (s3://$BUCKET)"
  else
    red "S3 get-object mismatch (s3://$BUCKET)"
    S3_OK=false
  fi
fi

if $S3_OK; then
  if aws s3api delete-object --bucket "$BUCKET" --key "$TEST_KEY" --profile "$PROFILE" >/dev/null 2>&1; then
    green "S3 delete-object cleanup"
  else
    red "S3 delete-object failed"
  fi
fi

# ── 3. Lambda function exists ──────────────────
echo "[3/9] Lambda"
if aws lambda get-function --function-name "$LAMBDA" --profile "$PROFILE" >/dev/null 2>&1; then
  RUNTIME=$(aws lambda get-function --function-name "$LAMBDA" --profile "$PROFILE" --query 'Configuration.Runtime' --output text 2>/dev/null)
  green "Lambda exists: $LAMBDA ($RUNTIME)"
else
  red "Lambda not found: $LAMBDA"
fi

# ── 4. Chrome extension manifest.json ──────────
echo "[4/9] Chrome Extension"
MANIFEST="$EXTENSION_DIR/manifest.json"
if [ -f "$MANIFEST" ]; then
  if python3 -c "import json, sys; d=json.load(open(sys.argv[1])); assert 'permissions' in d" "$MANIFEST" 2>/dev/null; then
    PERMS=$(python3 -c "import json,sys; print(', '.join(json.load(open(sys.argv[1]))['permissions']))" "$MANIFEST" 2>/dev/null)
    green "manifest.json valid (permissions: $PERMS)"
  else
    red "manifest.json invalid or missing permissions"
  fi
else
  red "manifest.json not found at $MANIFEST"
fi

# ── 5. Audio recorder deps (ffmpeg) ────────────
echo "[5/9] FFmpeg"
if ffmpeg -version >/dev/null 2>&1; then
  VER=$(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')
  green "ffmpeg available ($VER)"
else
  red "ffmpeg not found"
fi

# ── 6. Analysis pipeline Python deps ───────────
echo "[6/9] Python Dependencies"
pip3 install --break-system-packages boto3 anthropic >/dev/null 2>&1 || true
if python3 -c 'import boto3' 2>/dev/null; then
  green "python3 boto3"
else
  red "python3 boto3 not importable"
fi
if python3 -c 'import anthropic' 2>/dev/null; then
  green "python3 anthropic"
else
  red "python3 anthropic not importable"
fi

# ── 7. Node.js available ───────────────────────
echo "[7/9] Node.js"
if node --version >/dev/null 2>&1; then
  green "Node.js $(node --version)"
else
  red "Node.js not found"
fi

# ── 8. Git configured ──────────────────────────
echo "[8/9] Git"
GIT_NAME=$(git config user.name 2>/dev/null || true)
GIT_EMAIL=$(git config user.email 2>/dev/null || true)
if [ -n "$GIT_NAME" ] && [ -n "$GIT_EMAIL" ]; then
  green "Git configured ($GIT_NAME <$GIT_EMAIL>)"
else
  red "Git user.name or user.email not set"
fi

# ── 9. Watcher process ─────────────────────────
echo "[9/9] Watcher"
if [ -f "analysis/watcher.js" ]; then
  if node -e "require('./analysis/watcher.js')" >/dev/null 2>&1; then
    green "watcher.js loads without error"
  else
    red "watcher.js failed to load"
  fi
else
  red "analysis/watcher.js not found"
fi

# ── Summary ─────────────────────────────────────
echo ""
echo "============================================"
TOTAL=$((PASS + FAIL))
printf "  Results: \033[32m%d passed\033[0m, \033[31m%d failed\033[0m, %d total\n" "$PASS" "$FAIL" "$TOTAL"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
