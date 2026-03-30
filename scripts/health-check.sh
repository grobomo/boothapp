#!/usr/bin/env bash
# BoothApp environment health check
# Exit 0 if all checks pass, non-zero with details on failure.
set -euo pipefail

PASS=0
FAIL=0
DETAILS=""

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
    echo "[OK]   $name"
  else
    FAIL=$((FAIL + 1))
    DETAILS="${DETAILS}  - $name\n"
    echo "[FAIL] $name"
  fi
}

# 1. Node.js installed and >= 18
check "node installed (>=18 required)" node -e "
  const v = parseInt(process.versions.node.split('.')[0], 10);
  if (v < 18) { console.error('node ' + process.versions.node + ' < 18'); process.exit(1); }
"

# 2. Python 3 installed
check "python3 installed" python3 --version

# 3. AWS CLI configured (caller identity)
check "aws sts get-caller-identity" aws sts get-caller-identity

# 4. S3 bucket accessible
check "s3 bucket boothapp-sessions-752266476357" aws s3 ls s3://boothapp-sessions-752266476357

# 5. watcher.js can require all its dependencies
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -d "${REPO_ROOT}/analysis/node_modules" ]; then
  FAIL=$((FAIL + 1))
  DETAILS="${DETAILS}  - watcher.js dependencies (run: cd analysis && npm install)\n"
  echo "[FAIL] watcher.js dependencies (node_modules missing — run: cd analysis && npm install)"
else
  check "watcher.js dependencies" node -e "
    const dir = '${REPO_ROOT}/analysis';
    require(dir + '/lib/s3');
    require(dir + '/lib/pipeline');
    require(dir + '/node_modules/@aws-sdk/client-s3');
  "
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failed checks:"
  echo -e "$DETAILS"
  exit 1
fi

exit 0
