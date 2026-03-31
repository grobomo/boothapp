#!/usr/bin/env bash
# Smoke tests -- quick sanity checks that core files exist and load.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

passed=0
failed=0

check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS: $desc"
    passed=$((passed + 1))
  else
    echo "  FAIL: $desc"
    failed=$((failed + 1))
  fi
}

echo "Smoke tests"
echo "==========="

# Core files exist
check "package.json exists" test -f "$REPO_ROOT/package.json"
check "package.json is valid JSON" node -e "JSON.parse(require('fs').readFileSync('$REPO_ROOT/package.json','utf8'))"
check "presenter/server.js exists" test -f "$REPO_ROOT/presenter/server.js"
check "analysis directory exists" test -d "$REPO_ROOT/analysis"

# Node modules installed
check "node_modules exists" test -d "$REPO_ROOT/node_modules"

# Key modules load without error
check "express loads" node -e "require('express')"
check "cors loads" node -e "require('cors')"

# Presenter server.js has valid syntax (don't require -- it starts listening)
check "server.js valid syntax" node --check "$REPO_ROOT/presenter/server.js"

# Share page exists and has required elements
check "share.html exists" test -f "$REPO_ROOT/presenter/share.html"
check "share.html has no auth" node -e "var h=require('fs').readFileSync('$REPO_ROOT/presenter/share.html','utf8'); if(h.includes('auth.js')) process.exit(1)"
check "share.html has no transcript" node -e "var h=require('fs').readFileSync('$REPO_ROOT/presenter/share.html','utf8'); if(h.includes('transcript')) process.exit(1)"
check "share.html has no session_score" node -e "var h=require('fs').readFileSync('$REPO_ROOT/presenter/share.html','utf8'); if(h.includes('session_score')) process.exit(1)"

echo ""
echo "Results: $passed passed, $failed failed"
[ "$failed" -eq 0 ] || exit 1
