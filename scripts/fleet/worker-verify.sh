#!/usr/bin/env bash
# worker-verify.sh — Run all test scripts, create worker-passed marker, commit+push to PR branch
set -euo pipefail

TASK_NUM="${1:?Usage: worker-verify.sh T###}"
# Normalize: strip leading T if present
TASK_NUM="${TASK_NUM#T}"
TASK_ID="T${TASK_NUM}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
TEST_DIR="${REPO_ROOT}/scripts/test"
RESULTS_DIR="${REPO_ROOT}/.test-results"
MARKER_FILE="${RESULTS_DIR}/${TASK_ID}.worker-passed"

mkdir -p "${RESULTS_DIR}"

echo "=== Worker Verification for ${TASK_ID} ==="
echo "Running all test scripts in ${TEST_DIR}..."
echo ""

PASS_COUNT=0
FAIL_COUNT=0
TEST_OUTPUT=""
OVERALL_STATUS="PASSED"

# Run each test-*.sh file
if [ -d "${TEST_DIR}" ]; then
    for test_script in "${TEST_DIR}"/test-*.sh; do
        [ -f "${test_script}" ] || continue
        test_name="$(basename "${test_script}")"
        echo "--- Running: ${test_name} ---"

        set +e
        output="$(bash "${test_script}" 2>&1)"
        exit_code=$?
        set -e

        if [ ${exit_code} -eq 0 ]; then
            echo "  PASS: ${test_name}"
            PASS_COUNT=$((PASS_COUNT + 1))
            TEST_OUTPUT="${TEST_OUTPUT}\nPASS: ${test_name}\n${output}\n"
        else
            echo "  FAIL: ${test_name} (exit code: ${exit_code})"
            FAIL_COUNT=$((FAIL_COUNT + 1))
            TEST_OUTPUT="${TEST_OUTPUT}\nFAIL: ${test_name} (exit ${exit_code})\n${output}\n"
            OVERALL_STATUS="FAILED"
        fi
    done
else
    echo "No test directory found at ${TEST_DIR}"
    OVERALL_STATUS="SKIPPED (no tests)"
fi

echo ""
echo "=== Results: ${PASS_COUNT} passed, ${FAIL_COUNT} failed ==="

if [ "${FAIL_COUNT}" -gt 0 ]; then
    echo "ERROR: ${FAIL_COUNT} test(s) failed. Worker verification NOT created."
    exit 1
fi

# Create marker file
cat > "${MARKER_FILE}" <<EOF
task: ${TASK_ID}
verification: worker-passed
timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
tests_passed: ${PASS_COUNT}
tests_failed: ${FAIL_COUNT}
status: ${OVERALL_STATUS}
branch: $(git rev-parse --abbrev-ref HEAD)
commit: $(git rev-parse HEAD)

--- Test Output ---
$(echo -e "${TEST_OUTPUT}")
EOF

echo ""
echo "Worker verification marker created: ${MARKER_FILE}"

# Git add, commit, push
cd "${REPO_ROOT}"
git add ".test-results/${TASK_ID}.worker-passed"
git commit -m "chore: add worker verification marker for ${TASK_ID}

All ${PASS_COUNT} tests passed. Worker verification complete."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Pushing to origin/${BRANCH}..."
git push origin "${BRANCH}"

echo ""
echo "=== Worker verification complete for ${TASK_ID} ==="
