#!/usr/bin/env bash
# Run all unit tests using Node.js built-in test runner
# Usage: bash scripts/test/run-unit-tests.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "========================================"
echo " BoothApp Unit Tests"
echo "========================================"
echo ""

FAILED=0
TOTAL=0

run_test() {
  local file="$1"
  local name
  name="$(basename "$file")"
  TOTAL=$((TOTAL + 1))

  echo "--- $name ---"
  if node --test "$file" 2>&1; then
    echo "  OK"
  else
    echo "  FAILED"
    FAILED=$((FAILED + 1))
  fi
  echo ""
}

# Run all test files in tests/unit/ that match test-*.js
for test_file in "$PROJECT_ROOT"/tests/unit/test-*.js; do
  [ -f "$test_file" ] || continue
  run_test "$test_file"
done

echo "========================================"
echo " Results: $((TOTAL - FAILED))/$TOTAL passed"
if [ "$FAILED" -gt 0 ]; then
  echo " $FAILED test file(s) FAILED"
  exit 1
fi
echo " All tests passed."
echo "========================================"
