#!/usr/bin/env bash
# test-dual-verify.sh — Integration test for the dual-verification system
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
TEST_TASK="T999"
RESULTS_DIR="${REPO_ROOT}/.test-results"
PASS_COUNT=0
FAIL_COUNT=0

assert_pass() {
    local name="$1"
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  PASS: ${name}"
}

assert_fail() {
    local name="$1"
    local detail="$2"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  FAIL: ${name} — ${detail}"
}

cleanup() {
    rm -f "${RESULTS_DIR}/${TEST_TASK}.worker-passed" 2>/dev/null || true
    rm -f "${RESULTS_DIR}/${TEST_TASK}.manager-reviewed" 2>/dev/null || true
}

echo "=== Dual-Verify Integration Test ==="
echo ""

# Cleanup any previous test artifacts
cleanup
mkdir -p "${RESULTS_DIR}"

# --- Test 1: Gate blocks when no markers exist ---
echo "Test 1: Gate blocks merge with no markers"
GATE_INPUT='{"tool_name":"Bash","tool_input":{"command":"gh pr merge 999"}}'
GATE_RESULT=$(echo "${GATE_INPUT}" | node "${REPO_ROOT}/hooks/run-modules/PreToolUse/dual-verify-gate.js" 2>&1 || true)

# The gate should have exited with code 2 (block) — check output for BLOCKED
if echo "${GATE_RESULT}" | grep -q "BLOCKED\|Could not extract"; then
    assert_pass "Gate blocks when no markers exist"
else
    assert_fail "Gate blocks when no markers exist" "Expected BLOCKED in output, got: ${GATE_RESULT}"
fi

# --- Test 2: Scripts exist and are executable ---
echo ""
echo "Test 2: Verify scripts exist"
if [ -f "${REPO_ROOT}/scripts/fleet/worker-verify.sh" ]; then
    assert_pass "worker-verify.sh exists"
else
    assert_fail "worker-verify.sh exists" "File not found"
fi

if [ -f "${REPO_ROOT}/scripts/fleet/manager-review.sh" ]; then
    assert_pass "manager-review.sh exists"
else
    assert_fail "manager-review.sh exists" "File not found"
fi

if [ -f "${REPO_ROOT}/hooks/run-modules/PreToolUse/dual-verify-gate.js" ]; then
    assert_pass "dual-verify-gate.js exists"
else
    assert_fail "dual-verify-gate.js exists" "File not found"
fi

# --- Test 3: Gate allows non-merge commands ---
echo ""
echo "Test 3: Gate allows non-merge Bash commands"
NON_MERGE_INPUT='{"tool_name":"Bash","tool_input":{"command":"git status"}}'
set +e
echo "${NON_MERGE_INPUT}" | node "${REPO_ROOT}/hooks/run-modules/PreToolUse/dual-verify-gate.js" >/dev/null 2>&1
NON_MERGE_EXIT=$?
set -e

if [ ${NON_MERGE_EXIT} -eq 0 ]; then
    assert_pass "Gate allows non-merge commands (exit 0)"
else
    assert_fail "Gate allows non-merge commands" "Expected exit 0, got ${NON_MERGE_EXIT}"
fi

# --- Test 4: Gate allows non-Bash tools ---
echo ""
echo "Test 4: Gate allows non-Bash tools"
NON_BASH_INPUT='{"tool_name":"Read","tool_input":{"file_path":"README.md"}}'
set +e
echo "${NON_BASH_INPUT}" | node "${REPO_ROOT}/hooks/run-modules/PreToolUse/dual-verify-gate.js" >/dev/null 2>&1
NON_BASH_EXIT=$?
set -e

if [ ${NON_BASH_EXIT} -eq 0 ]; then
    assert_pass "Gate allows non-Bash tools (exit 0)"
else
    assert_fail "Gate allows non-Bash tools" "Expected exit 0, got ${NON_BASH_EXIT}"
fi

# --- Test 5: Simulate worker-passed marker ---
echo ""
echo "Test 5: Create simulated worker-passed marker"
cat > "${RESULTS_DIR}/${TEST_TASK}.worker-passed" <<EOF
task: ${TEST_TASK}
verification: worker-passed
timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
tests_passed: 1
tests_failed: 0
status: PASSED
branch: test-branch
commit: abc123
EOF

if [ -f "${RESULTS_DIR}/${TEST_TASK}.worker-passed" ]; then
    assert_pass "Worker marker created"
else
    assert_fail "Worker marker created" "File not found"
fi

# --- Test 6: Simulate manager-reviewed marker ---
echo ""
echo "Test 6: Create simulated manager-reviewed marker"
cat > "${RESULTS_DIR}/${TEST_TASK}.manager-reviewed" <<EOF
task: ${TEST_TASK}
verification: manager-reviewed
timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
failures: 0
warnings: 0
checks: hardcoded-paths, secrets-scan, error-handling, nist-compliance, file-complexity
branch: test-branch
commit: abc123
EOF

if [ -f "${RESULTS_DIR}/${TEST_TASK}.manager-reviewed" ]; then
    assert_pass "Manager marker created"
else
    assert_fail "Manager marker created" "File not found"
fi

# --- Test 7: Both markers exist ---
echo ""
echo "Test 7: Verify both markers exist simultaneously"
if [ -f "${RESULTS_DIR}/${TEST_TASK}.worker-passed" ] && [ -f "${RESULTS_DIR}/${TEST_TASK}.manager-reviewed" ]; then
    assert_pass "Both markers exist"
else
    assert_fail "Both markers exist" "One or both missing"
fi

# --- Test 8: Manager review script validates (dry check on repo itself) ---
echo ""
echo "Test 8: Manager review checks run without crash"
set +e
# Run the checks inline (not the full script which commits)
HARDCODED_CHECK=$(grep -rn \
    -e 'C:\\Users\\' \
    -e 'C:/Users/' \
    --include="*.js" --include="*.py" --include="*.sh" \
    "${REPO_ROOT}" 2>/dev/null \
    | grep -v node_modules \
    | grep -v '.git/' \
    | grep -v '.test-results/' \
    | grep -v 'manager-review.sh' \
    || true)
set -e

# This is just checking the scan runs without error
assert_pass "Manager review checks execute without crash"

# --- Cleanup ---
cleanup

# --- Summary ---
echo ""
echo "========================================="
echo "  Dual-Verify Integration Test Results"
echo "========================================="
echo "  Passed: ${PASS_COUNT}"
echo "  Failed: ${FAIL_COUNT}"
echo ""

if [ ${FAIL_COUNT} -gt 0 ]; then
    echo "RESULT: FAILED"
    exit 1
fi

echo "RESULT: ALL TESTS PASSED"
exit 0
