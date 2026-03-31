#!/usr/bin/env bash
# test-encryption.sh -- Verify hackathon26 KMS + S3 encryption enforcement
# Usage: ./scripts/test/test-encryption.sh [--profile PROFILE] [--region REGION]
set -euo pipefail

PROFILE=""
REGION="us-east-1"
ALIAS="alias/hackathon26-cmk"
BUCKETS=("boothapp-sessions-752266476357" "hackathon26-state-752266476357")
PASS=0
FAIL=0
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="--profile $2"; shift 2 ;;
    --region)  REGION="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

AWS="aws $PROFILE --region $REGION --output text"

pass() { echo "[PASS] $1"; ((PASS++)); }
fail() { echo "[FAIL] $1"; ((FAIL++)); }

# -----------------------------------------------------------
# 1. KMS key exists and has auto-rotation
# -----------------------------------------------------------
echo "=== KMS Key ==="

KEY_ID=$($AWS kms describe-key --key-id "$ALIAS" --query 'KeyMetadata.KeyId' 2>/dev/null) || true
if [[ -z "$KEY_ID" || "$KEY_ID" == "None" ]]; then
  fail "KMS key $ALIAS not found"
else
  pass "KMS key $ALIAS exists (KeyId: $KEY_ID)"

  ROTATION=$($AWS kms get-key-rotation-status --key-id "$KEY_ID" --query 'KeyRotationEnabled' 2>/dev/null) || true
  if [[ "$ROTATION" == "True" ]]; then
    pass "Auto-rotation enabled"
  else
    fail "Auto-rotation NOT enabled (got: $ROTATION)"
  fi

  KEY_ARN=$($AWS kms describe-key --key-id "$KEY_ID" --query 'KeyMetadata.Arn' 2>/dev/null)
fi

# -----------------------------------------------------------
# 2. S3 buckets reject unencrypted PUTs
# -----------------------------------------------------------
echo ""
echo "=== S3 Encryption Enforcement ==="
echo "test-payload" > "$TMPFILE"

for BUCKET in "${BUCKETS[@]}"; do
  TEST_KEY="_encryption-test/$(date +%s).txt"

  # 2a. Unencrypted PUT should be denied
  if $AWS s3api put-object \
       --bucket "$BUCKET" \
       --key "$TEST_KEY" \
       --body "$TMPFILE" 2>/dev/null; then
    fail "$BUCKET accepted unencrypted PUT"
    $AWS s3api delete-object --bucket "$BUCKET" --key "$TEST_KEY" 2>/dev/null || true
  else
    pass "$BUCKET rejected unencrypted PUT"
  fi

  # 2b. Encrypted PUT with the CMK should succeed
  if [[ -n "${KEY_ARN:-}" ]]; then
    if $AWS s3api put-object \
         --bucket "$BUCKET" \
         --key "$TEST_KEY" \
         --body "$TMPFILE" \
         --server-side-encryption aws:kms \
         --ssekms-key-id "$KEY_ARN" 2>/dev/null; then
      pass "$BUCKET accepted SSE-KMS PUT"
      $AWS s3api delete-object --bucket "$BUCKET" --key "$TEST_KEY" 2>/dev/null || true
    else
      fail "$BUCKET rejected SSE-KMS PUT (check key policy)"
    fi
  else
    fail "$BUCKET: skipped encrypted PUT (no key ARN)"
  fi
done

# -----------------------------------------------------------
# Summary
# -----------------------------------------------------------
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
