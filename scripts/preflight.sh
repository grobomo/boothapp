#!/usr/bin/env bash
# BoothApp Demo Preflight Checker
# Validates all dependencies and services before a demo session.
# Exit 0 = all pass, Exit 1 = one or more failures.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- Color output ---
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf "  ${GREEN}PASS${RESET}  %s\n" "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf "  ${RED}FAIL${RESET}  %s\n" "$1"
  if [ -n "${2:-}" ]; then
    printf "        ${YELLOW}^ %s${RESET}\n" "$2"
  fi
}

header() {
  printf "\n${BOLD}=== %s ===${RESET}\n" "$1"
}

# =====================================================================
header "AWS CLI"
# =====================================================================

# 1) AWS CLI configured
if aws sts get-caller-identity --profile hackathon >/dev/null 2>&1; then
  IDENTITY=$(aws sts get-caller-identity --profile hackathon --query 'Account' --output text 2>/dev/null)
  pass "AWS CLI configured (account: ${IDENTITY})"
else
  fail "AWS CLI not configured or credentials expired" "Run: aws configure --profile hackathon"
fi

# =====================================================================
header "AWS Resources"
# =====================================================================

# 2) S3 bucket accessible
BUCKET="boothapp-sessions-752266476357"
if aws s3 ls "s3://${BUCKET}" --profile hackathon >/dev/null 2>&1; then
  pass "S3 bucket ${BUCKET} accessible"
else
  fail "S3 bucket ${BUCKET} not accessible" "Check bucket exists and credentials have s3:ListBucket"
fi

# 3) Lambda function exists
LAMBDA_NAME="boothapp-session-orchestrator"
if aws lambda get-function --function-name "${LAMBDA_NAME}" --profile hackathon --region us-east-1 --query 'Configuration.FunctionName' --output text >/dev/null 2>&1; then
  pass "Lambda function ${LAMBDA_NAME} exists"
else
  fail "Lambda function ${LAMBDA_NAME} not found" "Deploy with: cd infra/session-orchestrator && bash deploy.sh"
fi

# =====================================================================
header "Chrome Extension"
# =====================================================================

# 4) Chrome extension manifest valid
MANIFEST="${REPO_ROOT}/extension/manifest.json"
if [ -f "${MANIFEST}" ]; then
  if node -e "JSON.parse(require('fs').readFileSync('${MANIFEST}','utf8'))" >/dev/null 2>&1; then
    EXT_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${MANIFEST}','utf8')).name || 'unnamed')" 2>/dev/null)
    pass "Chrome extension manifest valid (${EXT_NAME})"
  else
    fail "Chrome extension manifest is invalid JSON" "Fix: ${MANIFEST}"
  fi
else
  fail "Chrome extension manifest not found" "Expected: ${MANIFEST}"
fi

# =====================================================================
header "System Tools"
# =====================================================================

# 5) ffmpeg available
if command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG_VER=$(ffmpeg -version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  pass "ffmpeg available (${FFMPEG_VER:-unknown version})"
else
  fail "ffmpeg not found" "Install: apt install ffmpeg / brew install ffmpeg"
fi

# 6) Node.js available
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version 2>/dev/null)
  NODE_MAJOR=$(echo "${NODE_VER}" | grep -oE '[0-9]+' | head -1)
  if [ "${NODE_MAJOR:-0}" -ge 18 ]; then
    pass "Node.js available (${NODE_VER})"
  else
    fail "Node.js version too old (${NODE_VER})" "Requires >= 18"
  fi
else
  fail "Node.js not found" "Install: https://nodejs.org/"
fi

# 7) Git configured
if command -v git >/dev/null 2>&1; then
  GIT_USER=$(git config user.name 2>/dev/null || true)
  GIT_EMAIL=$(git config user.email 2>/dev/null || true)
  if [ -n "${GIT_USER}" ] && [ -n "${GIT_EMAIL}" ]; then
    pass "Git configured (${GIT_USER} <${GIT_EMAIL}>)"
  else
    fail "Git installed but user.name/user.email not set" "Run: git config user.name/email"
  fi
else
  fail "Git not found"
fi

# =====================================================================
header "Python Dependencies"
# =====================================================================

# 8) Python deps importable
if command -v python3 >/dev/null 2>&1; then
  PY_VER=$(python3 --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
  pass "Python 3 available (${PY_VER})"

  PYTHON_DEPS="anthropic boto3"
  for dep in ${PYTHON_DEPS}; do
    if python3 -c "import ${dep}" >/dev/null 2>&1; then
      DEP_VER=$(python3 -c "import ${dep}; print(getattr(${dep}, '__version__', 'installed'))" 2>/dev/null)
      pass "Python: ${dep} (${DEP_VER})"
    else
      fail "Python: ${dep} not importable" "Install: pip install ${dep}"
    fi
  done
else
  fail "Python 3 not found" "Install: https://python.org/"
  fail "Python: anthropic (skipped -- no python3)"
  fail "Python: boto3 (skipped -- no python3)"
fi

# =====================================================================
# Summary
# =====================================================================
TOTAL=$((PASS_COUNT + FAIL_COUNT))
printf "\n${BOLD}--- Results ---${RESET}\n"
printf "  ${GREEN}${PASS_COUNT} passed${RESET}  /  "
if [ "${FAIL_COUNT}" -gt 0 ]; then
  printf "${RED}${FAIL_COUNT} failed${RESET}  /  ${TOTAL} total\n\n"
  printf "${RED}${BOLD}PREFLIGHT FAILED${RESET} -- fix the issues above before demo day.\n"
  exit 1
else
  printf "${FAIL_COUNT} failed  /  ${TOTAL} total\n\n"
  printf "${GREEN}${BOLD}ALL CHECKS PASSED${RESET} -- ready for demo!\n"
  exit 0
fi
