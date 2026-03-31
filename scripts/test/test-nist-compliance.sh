#!/usr/bin/env bash
# NIST CSF 2.0 Compliance Scanner
# Scans .sh .py .js .yaml files for security violations.
# Exit 0 if clean, non-zero if violations found.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VIOLATIONS=0
SCAN_DIRS=("$REPO_ROOT")
EXCLUDE_DIRS="node_modules|\.git|vendor|dist|build|\.planning|__pycache__"

# Color output (skip if not a terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' NC=''
fi

log_violation() {
  local control="$1"
  local file="$2"
  local line="$3"
  local detail="$4"
  echo -e "${RED}VIOLATION${NC} [$control] $file:$line -- $detail"
  VIOLATIONS=$((VIOLATIONS + 1))
}

log_pass() {
  echo -e "${GREEN}PASS${NC} $1"
}

echo "=== NIST CSF 2.0 Compliance Scan ==="
echo "Repo: $REPO_ROOT"
echo ""

# Build file list
FILES=$(find "$REPO_ROOT" -type f \( -name '*.sh' -o -name '*.py' -o -name '*.js' -o -name '*.yaml' -o -name '*.yml' \) \
  | grep -Ev "($EXCLUDE_DIRS)" \
  | grep -v "test-nist-compliance.sh" \
  | grep -v "nist-encryption-gate.js" \
  | grep -v "nist-access-gate.js" \
  | sort)

if [ -z "$FILES" ]; then
  echo "No scannable files found."
  exit 0
fi

FILE_COUNT=$(echo "$FILES" | wc -l)
echo "Scanning $FILE_COUNT files..."
echo ""

# --- PR.DS-01: Unencrypted S3 uploads ---
echo "--- PR.DS-01: Data-at-Rest Encryption (KMS) ---"
FOUND=0
while IFS= read -r file; do
  while IFS=: read -r lineno line; do
    # Skip NIST-EXEMPT lines
    if echo "$line" | grep -q "NIST-EXEMPT"; then continue; fi
    # Check for aws s3 cp/sync without --sse
    if echo "$line" | grep -qiE '\baws\s+s3\s+(cp|sync)\b'; then
      if ! echo "$line" | grep -qiE '\-\-sse\s+aws:kms|--sse-c'; then
        # Skip downloads (s3:// source to local dest)
        if echo "$line" | grep -qE 's3://\S+\s+[^s]'; then
          continue
        fi
        log_violation "PR.DS-01" "$file" "$lineno" "S3 upload without --sse aws:kms"
        FOUND=1
      fi
    fi
  done < <(grep -nE '\baws\s+s3\s+(cp|sync)\b' "$file" 2>/dev/null || true)
done <<< "$FILES"
[ "$FOUND" -eq 0 ] && log_pass "No unencrypted S3 uploads found"
echo ""

# --- PR.DS-02: HTTP URLs (insecure transit) ---
echo "--- PR.DS-02: Data-in-Transit Encryption (TLS) ---"
FOUND=0
while IFS= read -r file; do
  while IFS=: read -r lineno line; do
    if echo "$line" | grep -q "NIST-EXEMPT"; then continue; fi
    # Skip localhost URLs
    if echo "$line" | grep -qE 'http://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])'; then
      continue
    fi
    # Skip XML namespace URIs (not actual network requests)
    if echo "$line" | grep -qE 'xmlns="http://|http://www\.w3\.org/|http://schemas\.' ; then
      continue
    fi
    # Skip shell variable interpolation (not a literal URL)
    if echo "$line" | grep -qE 'http://\$\{?\w' ; then
      continue
    fi
    # Skip comments that are just documenting the rule
    if echo "$line" | grep -qE '^\s*(#|//|/?\*)'; then continue; fi
    log_violation "PR.DS-02" "$file" "$lineno" "Insecure http:// URL"
    FOUND=1
  done < <(grep -nE 'http://[^[:space:]]' "$file" 2>/dev/null || true)
done <<< "$FILES"
[ "$FOUND" -eq 0 ] && log_pass "No insecure HTTP URLs found"
echo ""

# --- PR.AC-01: Hardcoded AWS credentials (AKIA pattern) ---
echo "--- PR.AC-01: IAM Least Privilege ---"
FOUND=0
while IFS= read -r file; do
  while IFS=: read -r lineno line; do
    if echo "$line" | grep -q "NIST-EXEMPT"; then continue; fi
    if echo "$line" | grep -qE '^\s*(#|//|/?\*)'; then continue; fi
    log_violation "PR.AC-01" "$file" "$lineno" "Hardcoded AWS access key ID (AKIA/ASIA pattern)"
    FOUND=1
  done < <(grep -nE '\bA[KS]IA[0-9A-Z]{16}\b' "$file" 2>/dev/null || true)
done <<< "$FILES"
[ "$FOUND" -eq 0 ] && log_pass "No hardcoded AWS credentials found"
echo ""

# --- PR.DS-10: Plaintext secrets ---
echo "--- PR.DS-10: Key Management ---"
FOUND=0
while IFS= read -r file; do
  while IFS=: read -r lineno line; do
    if echo "$line" | grep -q "NIST-EXEMPT"; then continue; fi
    if echo "$line" | grep -qE '^\s*(#|//|/?\*)'; then continue; fi
    log_violation "PR.DS-10" "$file" "$lineno" "Plaintext secret assignment"
    FOUND=1
  done < <(grep -nE '(PASSWORD|SECRET_KEY|API_KEY|PRIVATE_KEY)\s*[=:]\s*["'"'"'][^$\{]' "$file" 2>/dev/null || true)
done <<< "$FILES"
[ "$FOUND" -eq 0 ] && log_pass "No plaintext secrets found"
echo ""

# --- Summary ---
echo "=== Scan Complete ==="
if [ "$VIOLATIONS" -gt 0 ]; then
  echo -e "${RED}$VIOLATIONS violation(s) found.${NC}"
  exit 1
else
  echo -e "${GREEN}All checks passed. 0 violations.${NC}"
  exit 0
fi
