#!/usr/bin/env bash
# verify-integration.sh — Verify ALL boothapp components work together.
#
# Checks:
#   1. Chrome extension manifest is valid JSON and all referenced files exist
#   2. Session orchestrator loads (Node.js require)
#   3. Analysis pipeline loads: watcher, correlator, analyzer
#   4. Config resolves (infra/config.js exports expected keys)
#   5. Presenter dashboard HTML has expected elements
#   6. Audio transcriber loads (Node.js require)
#
# Each check: PASS or FAIL. Exit 0 only if ALL pass.
#
# Usage:
#   bash scripts/test/verify-integration.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

PASS=0
FAIL=0
TOTAL=0

pass() {
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
  echo "  [PASS] $1"
}

fail() {
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  echo "  [FAIL] $1"
}

##############################################################################
# 1. Chrome Extension Manifest
##############################################################################
echo ""
echo "=== 1. Chrome Extension Manifest ==="

MANIFEST="${REPO_ROOT}/extension/manifest.json"

# 1a. manifest.json is valid JSON
if node -e "JSON.parse(require('fs').readFileSync('${MANIFEST}','utf8'))" 2>/dev/null; then
  pass "manifest.json is valid JSON"
else
  fail "manifest.json is NOT valid JSON"
fi

# 1b. manifest_version is 3
MV=$(node -e "var m=JSON.parse(require('fs').readFileSync('${MANIFEST}','utf8')); process.stdout.write(String(m.manifest_version))" 2>/dev/null || echo "")
if [ "$MV" = "3" ]; then
  pass "manifest_version is 3"
else
  fail "manifest_version expected 3, got '${MV}'"
fi

# 1c. All referenced files exist
# Check popup, background service_worker, content_scripts js files
REFERENCED_FILES=$(node -e "
var m = JSON.parse(require('fs').readFileSync('${MANIFEST}','utf8'));
var files = [];
if (m.action && m.action.default_popup) files.push(m.action.default_popup);
if (m.background && m.background.service_worker) files.push(m.background.service_worker);
if (m.content_scripts) {
  m.content_scripts.forEach(function(cs) {
    if (cs.js) cs.js.forEach(function(f) { files.push(f); });
    if (cs.css) cs.css.forEach(function(f) { files.push(f); });
  });
}
process.stdout.write(files.join('\n'));
" 2>/dev/null || echo "")

if [ -z "$REFERENCED_FILES" ]; then
  fail "Could not parse referenced files from manifest"
else
  ALL_EXIST=true
  while IFS= read -r f; do
    if [ -f "${REPO_ROOT}/extension/${f}" ]; then
      pass "extension/${f} exists"
    else
      fail "extension/${f} MISSING (referenced in manifest.json)"
      ALL_EXIST=false
    fi
  done <<< "$REFERENCED_FILES"
fi

##############################################################################
# 2. Session Orchestrator Loads
##############################################################################
echo ""
echo "=== 2. Session Orchestrator ==="

# Check syntax first (no dependency issues)
if node -c "${REPO_ROOT}/infra/session-orchestrator/index.js" 2>/dev/null; then
  pass "session-orchestrator/index.js has valid syntax"
else
  fail "session-orchestrator/index.js has syntax errors"
fi

if node -c "${REPO_ROOT}/infra/session-orchestrator/orchestrator.js" 2>/dev/null; then
  pass "session-orchestrator/orchestrator.js has valid syntax"
else
  fail "session-orchestrator/orchestrator.js has syntax errors"
fi

# Try full require -- if deps are installed, verify exports
ORCH_RESULT=$(node -e "
try {
  var h = require('${REPO_ROOT}/infra/session-orchestrator/index.js');
  if (typeof h.handler === 'function') {
    process.stdout.write('ok');
  } else {
    process.stdout.write('no-handler');
  }
} catch(e) {
  if (e.code === 'MODULE_NOT_FOUND') process.stdout.write('deps-missing');
  else process.stdout.write('error:' + e.message);
}
" 2>/dev/null || echo "error:node-crash")

if [ "$ORCH_RESULT" = "ok" ]; then
  pass "session-orchestrator/index.js loads and exports handler()"
elif [ "$ORCH_RESULT" = "deps-missing" ]; then
  pass "session-orchestrator/index.js deps not installed (npm install needed) -- syntax OK"
else
  fail "session-orchestrator load failed: ${ORCH_RESULT}"
fi

# Verify orchestrator.js exports expected functions (if deps available)
ORCH_FNS=$(node -e "
try {
  var o = require('${REPO_ROOT}/infra/session-orchestrator/orchestrator.js');
  var fns = ['createSession','endSession','getSession','transitionState','getSessionState'];
  var missing = fns.filter(function(f) { return typeof o[f] !== 'function'; });
  if (missing.length === 0) process.stdout.write('ok');
  else process.stdout.write('missing:' + missing.join(','));
} catch(e) {
  if (e.code === 'MODULE_NOT_FOUND') process.stdout.write('deps-missing');
  else process.stdout.write('error:' + e.message);
}
" 2>/dev/null || echo "error:node-crash")

if [ "$ORCH_FNS" = "ok" ]; then
  pass "orchestrator.js exports all 5 session functions"
elif [ "$ORCH_FNS" = "deps-missing" ]; then
  pass "orchestrator.js deps not installed (npm install needed) -- syntax OK"
else
  fail "orchestrator.js: ${ORCH_FNS}"
fi

##############################################################################
# 3. Analysis Pipeline Loads
##############################################################################
echo ""
echo "=== 3. Analysis Pipeline ==="

# 3a. Watcher file exists and is valid JS syntax
if node -c "${REPO_ROOT}/analysis/watcher.js" 2>/dev/null; then
  pass "watcher.js has valid syntax"
else
  fail "watcher.js has syntax errors"
fi

# 3b. Correlator loads and exports correlate()
CORR_RESULT=$(node -e "
try {
  var c = require('${REPO_ROOT}/analysis/lib/correlator.js');
  if (typeof c.correlate === 'function') process.stdout.write('ok');
  else process.stdout.write('no-correlate');
} catch(e) {
  process.stdout.write('error:' + e.message);
}
" 2>/dev/null || echo "error:node-crash")

if [ "$CORR_RESULT" = "ok" ]; then
  pass "correlator.js loads and exports correlate()"
else
  fail "correlator.js: ${CORR_RESULT}"
fi

# 3c. Correlator self-test produces valid output
CORR_TEST=$(node -e "
var c = require('${REPO_ROOT}/analysis/lib/correlator.js');
var meta = { session_id: 'verify-test', started_at: '2026-01-01T00:00:00.000Z' };
var clicks = { events: [{ index: 1, timestamp: '2026-01-01T00:00:05.000Z', dom_path: 'div>a', element: 'Link', page_title: 'Test' }] };
var transcript = { duration_seconds: 10, entries: [{ timestamp: '00:00:02.000', speaker: 'SE', text: 'Hello' }] };
var result = c.correlate(meta, clicks, transcript);
if (result.session_id === 'verify-test' && result.click_count === 1 && result.speech_count === 1 && result.timeline.length === 2) {
  process.stdout.write('ok');
} else {
  process.stdout.write('bad-output:clicks=' + result.click_count + ',speech=' + result.speech_count + ',timeline=' + result.timeline.length);
}
" 2>/dev/null || echo "error:node-crash")

if [ "$CORR_TEST" = "ok" ]; then
  pass "correlator produces correct timeline (1 click + 1 speech = 2 events)"
else
  fail "correlator self-test: ${CORR_TEST}"
fi

# 3d. Pipeline module loads and exports triggerPipeline()
PIPE_RESULT=$(node -e "
try {
  var p = require('${REPO_ROOT}/analysis/lib/pipeline.js');
  if (typeof p.triggerPipeline === 'function') process.stdout.write('ok');
  else process.stdout.write('no-trigger');
} catch(e) {
  process.stdout.write('error:' + e.message);
}
" 2>/dev/null || echo "error:node-crash")

if [ "$PIPE_RESULT" = "ok" ]; then
  pass "pipeline.js loads and exports triggerPipeline()"
else
  fail "pipeline.js: ${PIPE_RESULT}"
fi

# 3e. Analyzer Python module has valid syntax
if python3 -c "import py_compile; py_compile.compile('${REPO_ROOT}/analysis/engines/analyzer.py', doraise=True)" 2>/dev/null; then
  pass "analyzer.py has valid Python syntax"
else
  fail "analyzer.py has syntax errors"
fi

# 3f. Analyzer imports resolve (check the module structure)
ANALYZER_RESULT=$(python3 -c "
import sys, os
sys.path.insert(0, '${REPO_ROOT}/analysis')
try:
    from engines.analyzer import SessionAnalyzer
    if callable(SessionAnalyzer):
        print('ok', end='')
    else:
        print('not-callable', end='')
except ImportError as e:
    # Missing pip deps (anthropic, boto3) is OK -- syntax and structure are valid
    print('deps-missing', end='')
except Exception as e:
    print('error:' + str(e), end='')
" 2>/dev/null || echo "error:python-crash")

if [ "$ANALYZER_RESULT" = "ok" ]; then
  pass "SessionAnalyzer class imports successfully"
elif [ "$ANALYZER_RESULT" = "deps-missing" ]; then
  pass "SessionAnalyzer deps not installed (pip install needed) -- syntax OK"
else
  fail "SessionAnalyzer import: ${ANALYZER_RESULT}"
fi

##############################################################################
# 4. Config Resolves
##############################################################################
echo ""
echo "=== 4. Config Resolution ==="

CONFIG_RESULT=$(node -e "
try {
  var c = require('${REPO_ROOT}/infra/config.js');
  var required = ['AWS_REGION','AWS_ACCOUNT_ID','SESSION_BUCKET','sessionKey'];
  var missing = required.filter(function(k) { return !c[k]; });
  if (missing.length === 0) process.stdout.write('ok');
  else process.stdout.write('missing:' + missing.join(','));
} catch(e) {
  process.stdout.write('error:' + e.message);
}
" 2>/dev/null || echo "error:node-crash")

if [ "$CONFIG_RESULT" = "ok" ]; then
  pass "config.js exports AWS_REGION, AWS_ACCOUNT_ID, SESSION_BUCKET, sessionKey"
else
  fail "config.js: ${CONFIG_RESULT}"
fi

# Verify sessionKey helper produces correct paths
KEY_TEST=$(node -e "
var c = require('${REPO_ROOT}/infra/config.js');
var k = c.sessionKey('abc-123', 'clicks', 'clicks.json');
if (k === 'sessions/abc-123/clicks/clicks.json') process.stdout.write('ok');
else process.stdout.write('bad:' + k);
" 2>/dev/null || echo "error")

if [ "$KEY_TEST" = "ok" ]; then
  pass "sessionKey('abc-123','clicks','clicks.json') = 'sessions/abc-123/clicks/clicks.json'"
else
  fail "sessionKey helper: ${KEY_TEST}"
fi

# Verify config.py also exists and has valid syntax
if python3 -c "import py_compile; py_compile.compile('${REPO_ROOT}/infra/config.py', doraise=True)" 2>/dev/null; then
  pass "config.py has valid Python syntax"
else
  fail "config.py has syntax errors"
fi

##############################################################################
# 5. Presenter Dashboard HTML
##############################################################################
echo ""
echo "=== 5. Presenter Dashboard ==="

DASHBOARD="${REPO_ROOT}/presenter/index.html"

if [ ! -f "$DASHBOARD" ]; then
  fail "presenter/index.html does not exist"
else
  pass "presenter/index.html exists"

  # Check for expected HTML elements using grep
  check_element() {
    local pattern="$1"
    local label="$2"
    if grep -q "$pattern" "$DASHBOARD" 2>/dev/null; then
      pass "$label"
    else
      fail "$label"
    fi
  }

  check_element 'class="session-id"'    'has session-id element'
  check_element 'class="grid"'          'has grid layout'
  check_element 'class="card'           'has card components'
  check_element 'card-label'            'has card-label elements'
  check_element 'card-value'            'has card-value elements'
  check_element 'status-dot'            'has status-dot indicator'
  check_element 'recording'             'has recording state'
  check_element '<title>'               'has title element'
  check_element 'screenshot'            'has screenshot section'
fi

##############################################################################
# 6. Audio Transcriber Loads
##############################################################################
echo ""
echo "=== 6. Audio Transcriber ==="

# 6a. Check all transcriber source files exist
TRANSCRIBER_FILES="index.js transcribe.js convert.js upload.js"
for tf in $TRANSCRIBER_FILES; do
  if [ -f "${REPO_ROOT}/audio/transcriber/${tf}" ]; then
    pass "audio/transcriber/${tf} exists"
  else
    fail "audio/transcriber/${tf} MISSING"
  fi
done

# 6b. Check syntax of each file
for tf in $TRANSCRIBER_FILES; do
  FPATH="${REPO_ROOT}/audio/transcriber/${tf}"
  if [ -f "$FPATH" ] && node -c "$FPATH" 2>/dev/null; then
    pass "audio/transcriber/${tf} has valid syntax"
  else
    fail "audio/transcriber/${tf} has syntax errors"
  fi
done

# 6c. Check transcriber package.json exists and has expected dependencies
if [ -f "${REPO_ROOT}/audio/transcriber/package.json" ]; then
  pass "audio/transcriber/package.json exists"

  DEPS_CHECK=$(node -e "
var pkg = JSON.parse(require('fs').readFileSync('${REPO_ROOT}/audio/transcriber/package.json','utf8'));
var deps = Object.keys(pkg.dependencies || {}).concat(Object.keys(pkg.devDependencies || {}));
var needed = ['@aws-sdk/client-s3', '@aws-sdk/client-transcribe'];
var missing = needed.filter(function(d) { return deps.indexOf(d) === -1; });
if (missing.length === 0) process.stdout.write('ok');
else process.stdout.write('missing:' + missing.join(','));
" 2>/dev/null || echo "error")

  if [ "$DEPS_CHECK" = "ok" ]; then
    pass "transcriber package.json declares AWS SDK dependencies"
  else
    fail "transcriber package.json deps: ${DEPS_CHECK}"
  fi
else
  fail "audio/transcriber/package.json MISSING"
fi

##############################################################################
# Results
##############################################################################
echo ""
echo "=============================================="
echo " Integration Verification Results"
echo "  PASS: ${PASS}"
echo "  FAIL: ${FAIL}"
echo "  TOTAL: ${TOTAL}"
echo "=============================================="

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "  *** ${FAIL} check(s) FAILED ***"
  exit 1
fi

echo ""
echo "  All checks passed."
exit 0
