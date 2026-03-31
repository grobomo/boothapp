#!/usr/bin/env bash
# ============================================================================
# BoothApp Quick-Start Setup
# Idempotent -- safe to re-run at any time.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

AWS_PROFILE="${AWS_PROFILE:-hackathon}"
AWS_REGION="${AWS_REGION:-us-east-1}"
S3_BUCKET="${BOOTH_S3_BUCKET:-boothapp-sessions-752266476357}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
pass=0
fail=0
warn=0

ok()   { echo "  [OK]   $1"; pass=$((pass + 1)); }
fail() { echo "  [FAIL] $1"; fail=$((fail + 1)); }
skip() { echo "  [SKIP] $1"; warn=$((warn + 1)); }

header() { echo ""; echo "== $1 =="; }

# ---------------------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------------------
header "Checking prerequisites"

# Node.js
if command -v node &>/dev/null; then
  node_ver="$(node --version)"
  ok "Node.js $node_ver"
else
  fail "Node.js not found -- install from https://nodejs.org"
fi

# npm
if command -v npm &>/dev/null; then
  npm_ver="$(npm --version)"
  ok "npm $npm_ver"
else
  fail "npm not found"
fi

# AWS CLI
if command -v aws &>/dev/null; then
  aws_ver="$(aws --version 2>&1 | head -1)"
  ok "AWS CLI ($aws_ver)"
else
  fail "AWS CLI not found -- install from https://aws.amazon.com/cli/"
fi

# Chrome
chrome_found=false
for chrome_bin in google-chrome google-chrome-stable chromium chromium-browser \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"; do
  if command -v "$chrome_bin" &>/dev/null || [ -x "$chrome_bin" ] 2>/dev/null; then
    chrome_found=true
    ok "Chrome found ($chrome_bin)"
    break
  fi
done
if [ "$chrome_found" = false ]; then
  skip "Chrome not detected (needed for extension, not for backend)"
fi

# ---------------------------------------------------------------------------
# 2. Install npm dependencies
# ---------------------------------------------------------------------------
header "Installing npm dependencies"

installed_count=0
for pkg_dir in "$PROJECT_ROOT" "$PROJECT_ROOT"/analysis "$PROJECT_ROOT"/infra \
  "$PROJECT_ROOT"/infra/presign-lambda "$PROJECT_ROOT"/infra/notifications; do
  if [ -f "$pkg_dir/package.json" ]; then
    echo "  -> $pkg_dir"
    (cd "$pkg_dir" && npm install --no-audit --no-fund 2>&1 | tail -1)
    ok "npm install in $(basename "$pkg_dir")"
    installed_count=$((installed_count + 1))
  fi
done

if [ "$installed_count" -eq 0 ]; then
  skip "No package.json found in any component (dependencies may not be needed yet)"
fi

# ---------------------------------------------------------------------------
# 3. Verify AWS credentials
# ---------------------------------------------------------------------------
header "Verifying AWS credentials (profile: $AWS_PROFILE)"

if command -v aws &>/dev/null; then
  if aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION" &>/dev/null; then
    identity="$(aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION" \
      --query 'Arn' --output text 2>/dev/null)"
    ok "AWS identity: $identity"
  else
    fail "AWS credentials invalid or expired for profile '$AWS_PROFILE'"
  fi
else
  skip "AWS CLI not installed -- skipping credential check"
fi

# ---------------------------------------------------------------------------
# 4. Test S3 bucket access
# ---------------------------------------------------------------------------
header "Testing S3 bucket access ($S3_BUCKET)"

if command -v aws &>/dev/null; then
  if aws s3 ls "s3://$S3_BUCKET/" --profile "$AWS_PROFILE" --region "$AWS_REGION" \
    --max-items 1 &>/dev/null; then
    ok "S3 bucket is accessible"
  else
    fail "Cannot access s3://$S3_BUCKET (check permissions or bucket name)"
  fi
else
  skip "AWS CLI not installed -- skipping S3 check"
fi

# ---------------------------------------------------------------------------
# 5. Summary
# ---------------------------------------------------------------------------
header "Setup Summary"

echo ""
echo "  Components:"

# Check each component directory
for component in analysis infra/presign-lambda infra/notifications presenter examples; do
  dir="$PROJECT_ROOT/$component"
  if [ -d "$dir" ]; then
    if [ -f "$dir/package.json" ] && [ -d "$dir/node_modules" ]; then
      echo "    $(printf '%-30s' "$component") installed"
    elif [ -f "$dir/package.json" ]; then
      echo "    $(printf '%-30s' "$component") package.json (no node_modules)"
    else
      echo "    $(printf '%-30s' "$component") present (no npm deps)"
    fi
  else
    echo "    $(printf '%-30s' "$component") missing"
  fi
done

echo ""
echo "  Results: $pass passed, $fail failed, $warn skipped"
echo ""

if [ "$fail" -gt 0 ]; then
  echo "  Fix the failures above, then re-run: bash scripts/setup.sh"
  exit 1
else
  echo "  All checks passed. Run: bash scripts/start-all.sh"
  exit 0
fi
