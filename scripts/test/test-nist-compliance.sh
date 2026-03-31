#!/usr/bin/env bash
# NIST CSF 2.0 Compliance Scanner
# Scans codebase for violations of NIST controls.
# Exit 0 = compliant, Exit 1 = violations found.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VIOLATIONS=0
VIOLATION_LIST=""

add_violation() {
  local control="$1"
  local detail="$2"
  VIOLATIONS=$((VIOLATIONS + 1))
  VIOLATION_LIST="${VIOLATION_LIST}\n  [${control}] ${detail}"
}

# Filter out self-references and NIST rule docs from grep output
filter_self() {
  grep -v 'test-nist-compliance\.sh' | grep -v 'nist-.*\.md' || true
}

# Exclude patterns: test script itself, rule docs, node_modules, .git
EXCLUDE_DIRS="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.planning"
EXCLUDE_FILES="--exclude=*.example --exclude=*.sample --exclude=*.template"
SELF_SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

echo "=== NIST CSF 2.0 Compliance Scan ==="
echo "Scanning: ${REPO_ROOT}"
echo ""

# --- PR.AC-01: Hardcoded AWS Access Keys ---
echo -n "PR.AC-01  Hardcoded AWS keys............. "
HITS=$(grep -rn '\b\(AKIA\|ASIA\)[A-Z0-9]\{16\}\b' "$REPO_ROOT" \
  $EXCLUDE_DIRS $EXCLUDE_FILES \
  --include="*.js" --include="*.ts" --include="*.py" --include="*.json" \
  --include="*.yaml" --include="*.yml" --include="*.sh" --include="*.env" \
  --include="*.cfg" --include="*.conf" --include="*.ini" \
  2>/dev/null | filter_self)
if [ -n "$HITS" ]; then
  echo "FAIL"
  while IFS= read -r line; do
    add_violation "PR.AC-01" "$line"
  done <<< "$HITS"
else
  echo "PASS"
fi

# --- PR.AC-01: Hardcoded passwords ---
echo -n "PR.AC-01  Hardcoded passwords............ "
HITS=$(grep -rn -i '\(password\|passwd\|pwd\)\s*[=:]\s*["'"'"'][^"'"'"']\{4,\}["'"'"']' "$REPO_ROOT" \
  $EXCLUDE_DIRS $EXCLUDE_FILES \
  --include="*.js" --include="*.ts" --include="*.py" --include="*.json" \
  --include="*.yaml" --include="*.yml" --include="*.sh" --include="*.env" \
  2>/dev/null | filter_self)
if [ -n "$HITS" ]; then
  echo "FAIL"
  while IFS= read -r line; do
    add_violation "PR.AC-01" "$line"
  done <<< "$HITS"
else
  echo "PASS"
fi

# --- PR.AC-01: Private keys in source ---
echo -n "PR.DS-10  Private key material........... "
HITS=$(grep -rn 'BEGIN.*PRIVATE KEY' "$REPO_ROOT" \
  $EXCLUDE_DIRS $EXCLUDE_FILES \
  --include="*.js" --include="*.ts" --include="*.py" --include="*.json" \
  --include="*.yaml" --include="*.yml" --include="*.sh" --include="*.env" \
  --include="*.pem" --include="*.key" \
  2>/dev/null | filter_self)
if [ -n "$HITS" ]; then
  echo "FAIL"
  while IFS= read -r line; do
    add_violation "PR.DS-10" "$line"
  done <<< "$HITS"
else
  echo "PASS"
fi

# --- PR.DS-01: S3 uploads without encryption ---
echo -n "PR.DS-01  Unencrypted S3 operations...... "
# Find S3 cp/mv/sync without --sse
HITS=$(grep -rn 'aws\s\+s3\s\+\(cp\|mv\|sync\)\b' "$REPO_ROOT" \
  $EXCLUDE_DIRS $EXCLUDE_FILES \
  --include="*.sh" --include="*.js" --include="*.ts" --include="*.py" \
  --include="*.yaml" --include="*.yml" \
  2>/dev/null | grep -v '\-\-sse\s\+aws:kms\|--server-side-encryption' | filter_self)
if [ -n "$HITS" ]; then
  echo "FAIL"
  while IFS= read -r line; do
    add_violation "PR.DS-01" "$line"
  done <<< "$HITS"
else
  echo "PASS"
fi

# --- PR.DS-02: HTTP URLs (non-localhost) ---
echo -n "PR.DS-02  Plaintext HTTP URLs............ "
HITS=$(grep -rn 'http://' "$REPO_ROOT" \
  $EXCLUDE_DIRS $EXCLUDE_FILES \
  --include="*.js" --include="*.ts" --include="*.py" --include="*.json" \
  --include="*.yaml" --include="*.yml" --include="*.sh" --include="*.env" \
  --include="*.cfg" --include="*.conf" \
  2>/dev/null | grep -v 'http://localhost\|http://127\.0\.0\.1\|http://0\.0\.0\.0\|http://\[::1\]' | filter_self)
if [ -n "$HITS" ]; then
  echo "FAIL"
  while IFS= read -r line; do
    add_violation "PR.DS-02" "$line"
  done <<< "$HITS"
else
  echo "PASS"
fi

# --- ID.AM-01: CloudFormation encryption config ---
echo -n "ID.AM-01  CFN encryption config.......... "
CFN_FILES=$(find "$REPO_ROOT/cloudformation" -name "*.yaml" -o -name "*.yml" -o -name "*.json" 2>/dev/null || true)
CFN_FAIL=""
if [ -n "$CFN_FILES" ]; then
  for f in $CFN_FILES; do
    if grep -q 'AWS::S3::Bucket' "$f" 2>/dev/null; then
      if ! grep -q 'BucketEncryption\|ServerSideEncryptionConfiguration' "$f" 2>/dev/null; then
        CFN_FAIL="${CFN_FAIL}\n  ${f}: S3 bucket without BucketEncryption"
        add_violation "ID.AM-01" "${f}: S3 bucket missing BucketEncryption"
      fi
    fi
  done
fi
if [ -z "$CFN_FAIL" ]; then
  echo "PASS"
else
  echo "FAIL"
fi

# --- Summary ---
echo ""
echo "================================="
if [ $VIOLATIONS -eq 0 ]; then
  echo "RESULT: COMPLIANT (0 violations)"
  echo "All NIST CSF 2.0 checks passed."
  exit 0
else
  echo "RESULT: NON-COMPLIANT (${VIOLATIONS} violation(s))"
  echo -e "\nViolations:${VIOLATION_LIST}"
  exit 1
fi
