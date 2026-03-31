#!/usr/bin/env bash
# manager-review.sh — Independent code quality verification, creates manager-reviewed marker
set -euo pipefail

TASK_NUM="${1:?Usage: manager-review.sh T###}"
TASK_NUM="${TASK_NUM#T}"
TASK_ID="T${TASK_NUM}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
RESULTS_DIR="${REPO_ROOT}/.test-results"
MARKER_FILE="${RESULTS_DIR}/${TASK_ID}.manager-reviewed"

mkdir -p "${RESULTS_DIR}"

echo "=== Manager Review for ${TASK_ID} ==="
echo ""

FINDINGS=""
FAIL_COUNT=0
WARN_COUNT=0

add_finding() {
    local severity="$1"
    local check="$2"
    local detail="$3"
    FINDINGS="${FINDINGS}\n[${severity}] ${check}: ${detail}"
    if [ "${severity}" = "FAIL" ]; then
        FAIL_COUNT=$((FAIL_COUNT + 1))
    elif [ "${severity}" = "WARN" ]; then
        WARN_COUNT=$((WARN_COUNT + 1))
    fi
}

# --- Check 1: Hardcoded paths ---
echo "Checking for hardcoded paths..."
HARDCODED=$(grep -rn \
    -e 'C:\\Users\\' \
    -e 'C:/Users/' \
    -e '/home/[a-z]' \
    -e '/Users/[A-Z]' \
    --include="*.js" --include="*.py" --include="*.sh" --include="*.ts" \
    --include="*.json" --include="*.yaml" --include="*.yml" \
    "${REPO_ROOT}" 2>/dev/null \
    | grep -v node_modules \
    | grep -v '.git/' \
    | grep -v '.test-results/' \
    | grep -v 'manager-review\.sh' \
    | grep -v 'test-dual-verify\.sh' \
    || true)

if [ -n "${HARDCODED}" ]; then
    add_finding "FAIL" "hardcoded-paths" "Found hardcoded user paths:\n${HARDCODED}"
else
    echo "  PASS: No hardcoded paths found"
fi

# --- Check 2: Secrets scan ---
echo "Checking for secrets..."
SECRETS=$(grep -rn \
    -e 'API_KEY\s*=' \
    -e 'SECRET_KEY\s*=' \
    -e 'PASSWORD\s*=' \
    -e 'TOKEN\s*=\s*["\x27][A-Za-z0-9]' \
    -e 'AKIA[0-9A-Z]\{16\}' \
    -e 'sk-[A-Za-z0-9]\{20,\}' \
    --include="*.js" --include="*.py" --include="*.sh" --include="*.ts" \
    --include="*.json" --include="*.env" \
    "${REPO_ROOT}" 2>/dev/null \
    | grep -v node_modules \
    | grep -v '.git/' \
    | grep -v '.test-results/' \
    | grep -v 'test-' \
    | grep -v '\.example' \
    || true)

if [ -n "${SECRETS}" ]; then
    add_finding "FAIL" "secrets-scan" "Potential secrets found:\n${SECRETS}"
else
    echo "  PASS: No secrets detected"
fi

# --- Check 3: Error handling ---
echo "Checking error handling patterns..."
JS_FILES=$(find "${REPO_ROOT}" -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/.test-results/*" 2>/dev/null || true)
MISSING_ERROR_HANDLING=""
for f in ${JS_FILES}; do
    [ -f "$f" ] || continue
    # Check JS files with async operations but no try/catch or .catch
    HAS_ASYNC=$(grep -cE 'async|\.then|new Promise|await' "$f" 2>/dev/null || true)
    HAS_ASYNC="${HAS_ASYNC:-0}"
    HAS_CATCH=$(grep -cE 'catch|\.catch|try\s*\{' "$f" 2>/dev/null || true)
    HAS_CATCH="${HAS_CATCH:-0}"
    if [ "${HAS_ASYNC}" -gt 0 ] && [ "${HAS_CATCH}" -eq 0 ]; then
        MISSING_ERROR_HANDLING="${MISSING_ERROR_HANDLING}\n  ${f}"
    fi
done

if [ -n "${MISSING_ERROR_HANDLING}" ]; then
    add_finding "WARN" "error-handling" "Files with async ops but no error handling:${MISSING_ERROR_HANDLING}"
else
    echo "  PASS: Error handling looks adequate"
fi

# --- Check 4: NIST compliance basics ---
echo "Checking NIST compliance basics..."
NIST_ISSUES=""

# Check for eval() usage (code injection risk)
EVAL_USAGE=$(grep -rn 'eval(' \
    --include="*.js" --include="*.py" --include="*.ts" \
    "${REPO_ROOT}" 2>/dev/null \
    | grep -v node_modules \
    | grep -v '.git/' \
    | grep -v '.test-results/' \
    || true)
if [ -n "${EVAL_USAGE}" ]; then
    NIST_ISSUES="${NIST_ISSUES}\n  eval() usage (SI-10 Input Validation):\n${EVAL_USAGE}"
fi

# Check for exec/spawn without input sanitization
EXEC_USAGE=$(grep -rn 'child_process\|exec(\|execSync\|spawn(' \
    --include="*.js" --include="*.ts" \
    "${REPO_ROOT}" 2>/dev/null \
    | grep -v node_modules \
    | grep -v '.git/' \
    | grep -v '.test-results/' \
    | grep -v 'dual-verify-gate' \
    | grep -v 'worker-verify' \
    | grep -v 'manager-review' \
    || true)
if [ -n "${EXEC_USAGE}" ]; then
    NIST_ISSUES="${NIST_ISSUES}\n  Shell execution found (SI-10, review for injection):\n${EXEC_USAGE}"
fi

# Check for HTTP (non-HTTPS) URLs
HTTP_URLS=$(grep -rn 'http://' \
    --include="*.js" --include="*.py" --include="*.ts" --include="*.json" \
    "${REPO_ROOT}" 2>/dev/null \
    | grep -v node_modules \
    | grep -v '.git/' \
    | grep -v '.test-results/' \
    | grep -v 'localhost' \
    | grep -v '127.0.0.1' \
    || true)
if [ -n "${HTTP_URLS}" ]; then
    NIST_ISSUES="${NIST_ISSUES}\n  Non-HTTPS URLs (SC-8 Transmission Confidentiality):\n${HTTP_URLS}"
fi

if [ -n "${NIST_ISSUES}" ]; then
    add_finding "WARN" "nist-compliance" "NIST findings:${NIST_ISSUES}"
else
    echo "  PASS: NIST basic compliance checks passed"
fi

# --- Check 5: File size / complexity ---
echo "Checking for oversized files..."
LARGE_FILES=$(find "${REPO_ROOT}" \
    -name "*.js" -o -name "*.py" -o -name "*.ts" -o -name "*.sh" \
    | grep -v node_modules \
    | grep -v '.git/' \
    | while read -r f; do
        lines=$(wc -l < "$f" 2>/dev/null || echo 0)
        if [ "${lines}" -gt 500 ]; then
            echo "  ${f} (${lines} lines)"
        fi
    done || true)

if [ -n "${LARGE_FILES}" ]; then
    add_finding "WARN" "file-complexity" "Large files (>500 lines):\n${LARGE_FILES}"
else
    echo "  PASS: No oversized files"
fi

# --- Summary ---
echo ""
echo "========================================="
echo "  Manager Review Summary for ${TASK_ID}"
echo "========================================="
echo "  Failures: ${FAIL_COUNT}"
echo "  Warnings: ${WARN_COUNT}"
echo ""

if [ -n "${FINDINGS}" ]; then
    echo "Findings:"
    echo -e "${FINDINGS}"
    echo ""
fi

# Decision
if [ "${FAIL_COUNT}" -gt 0 ]; then
    echo "RESULT: FAILED — ${FAIL_COUNT} failure(s) found."
    echo "Manager review marker NOT created."

    # Post review comment if gh is available and we're in a PR context
    PR_NUM=$(gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --json number --jq '.[0].number' 2>/dev/null || true)
    if [ -n "${PR_NUM}" ]; then
        REVIEW_BODY="## Manager Review: ${TASK_ID} -- CHANGES REQUESTED

**Failures:** ${FAIL_COUNT}
**Warnings:** ${WARN_COUNT}

### Findings
$(echo -e "${FINDINGS}")

---
*Automated manager review. Fix failures and re-run \`scripts/fleet/manager-review.sh ${TASK_ID}\`*"

        gh pr review "${PR_NUM}" --request-changes --body "${REVIEW_BODY}" 2>/dev/null || true
        echo "Posted review comment requesting changes on PR #${PR_NUM}"
    fi

    exit 1
fi

# All checks passed — create marker
cat > "${MARKER_FILE}" <<EOF
task: ${TASK_ID}
verification: manager-reviewed
timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
failures: ${FAIL_COUNT}
warnings: ${WARN_COUNT}
checks: hardcoded-paths, secrets-scan, error-handling, nist-compliance, file-complexity
branch: $(git rev-parse --abbrev-ref HEAD)
commit: $(git rev-parse HEAD)

--- Findings ---
$(echo -e "${FINDINGS}")
EOF

echo ""
echo "Manager review marker created: ${MARKER_FILE}"

# Git add, commit, push
cd "${REPO_ROOT}"
git add ".test-results/${TASK_ID}.manager-reviewed"
git commit -m "chore: add manager review marker for ${TASK_ID}

Code quality checks passed. ${WARN_COUNT} warning(s), 0 failures."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Pushing to origin/${BRANCH}..."
git push origin "${BRANCH}"

# Post approval comment if in PR context
PR_NUM=$(gh pr list --head "${BRANCH}" --json number --jq '.[0].number' 2>/dev/null || true)
if [ -n "${PR_NUM}" ]; then
    REVIEW_BODY="## Manager Review: ${TASK_ID} -- APPROVED

**Failures:** 0
**Warnings:** ${WARN_COUNT}

All code quality checks passed.
$(if [ "${WARN_COUNT}" -gt 0 ]; then echo -e "\n### Warnings (non-blocking)\n$(echo -e "${FINDINGS}")"; fi)

---
*Automated manager review. Both worker and manager verification complete.*"

    gh pr review "${PR_NUM}" --approve --body "${REVIEW_BODY}" 2>/dev/null || true
    echo "Posted approval review on PR #${PR_NUM}"
fi

echo ""
echo "=== Manager review complete for ${TASK_ID} ==="
