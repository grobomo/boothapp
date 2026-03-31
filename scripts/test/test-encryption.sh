#!/usr/bin/env bash
# test-encryption.sh — Verify KMS key exists and S3 buckets reject unencrypted PUTs
# NIST CSF 2.0 PR.DS-10 compliance check
set -euo pipefail

PROFILE="${AWS_PROFILE:-hackathon}"
REGION="${AWS_REGION:-us-east-1}"
ALIAS="alias/hackathon26-cmk"
BUCKETS=(
  "boothapp-sessions-752266476357"
  "hackathon26-state-752266476357"
)
PASS=0
FAIL=0
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

echo "=== Hackathon26 Encryption Tests ==="
echo ""

# --- Test 1: KMS key exists with correct alias ---
echo "[TEST 1] KMS key alias $ALIAS exists"
KEY_ID=$(aws kms describe-key --key-id "$ALIAS" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'KeyMetadata.KeyId' --output text 2>/dev/null || true)

if [ -n "$KEY_ID" ] && [ "$KEY_ID" != "None" ]; then
  echo "  PASS - KeyId: $KEY_ID"
  ((PASS++))
else
  echo "  FAIL - KMS alias $ALIAS not found"
  ((FAIL++))
fi

# --- Test 2: Key rotation enabled ---
echo "[TEST 2] Key rotation is enabled"
if [ -n "$KEY_ID" ] && [ "$KEY_ID" != "None" ]; then
  ROTATION=$(aws kms get-key-rotation-status --key-id "$KEY_ID" \
    --profile "$PROFILE" --region "$REGION" \
    --query 'KeyRotationEnabled' --output text 2>/dev/null || true)
  if [ "$ROTATION" = "True" ]; then
    echo "  PASS - Rotation enabled"
    ((PASS++))
  else
    echo "  FAIL - Rotation not enabled (got: $ROTATION)"
    ((FAIL++))
  fi
else
  echo "  SKIP - No key to check"
  ((FAIL++))
fi

# --- Test 3: S3 buckets deny unencrypted PUTs ---
echo "test-payload" > "$TMPFILE"

for BUCKET in "${BUCKETS[@]}"; do
  echo "[TEST 3] S3 bucket $BUCKET denies unencrypted PUT"
  # Attempt a PUT without server-side encryption
  if aws s3api put-object \
    --bucket "$BUCKET" \
    --key "_encryption-test-$(date +%s)" \
    --body "$TMPFILE" \
    --profile "$PROFILE" --region "$REGION" 2>&1 | grep -qi "denied\|AccessDenied\|error"; then
    echo "  PASS - Unencrypted PUT correctly denied"
    ((PASS++))
  else
    echo "  FAIL - Unencrypted PUT was NOT denied (bucket policy missing or permissive)"
    ((FAIL++))
  fi
done

# --- Test 4: S3 encrypted PUT succeeds ---
for BUCKET in "${BUCKETS[@]}"; do
  echo "[TEST 4] S3 bucket $BUCKET allows KMS-encrypted PUT"
  TEST_KEY="_encryption-test-ok-$(date +%s)"
  if aws s3api put-object \
    --bucket "$BUCKET" \
    --key "$TEST_KEY" \
    --body "$TMPFILE" \
    --server-side-encryption aws:kms \
    --ssekms-key-id "$ALIAS" \
    --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1; then
    echo "  PASS - Encrypted PUT succeeded"
    ((PASS++))
    # Clean up test object
    aws s3api delete-object --bucket "$BUCKET" --key "$TEST_KEY" \
      --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1 || true
  else
    echo "  FAIL - Encrypted PUT was rejected"
    ((FAIL++))
  fi
done

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
exit "$FAIL"
