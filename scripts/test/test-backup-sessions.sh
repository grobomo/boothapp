#!/usr/bin/env bash
#
# test-backup-sessions.sh -- Unit tests for backup-sessions.sh
#
# Tests argument parsing, help output, and error handling without AWS access.
# Usage: bash scripts/test/test-backup-sessions.sh

set -euo pipefail

SCRIPT="scripts/backup-sessions.sh"
PASS=0
FAIL=0

green() { printf '\033[32m  PASS\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
red()   { printf '\033[31m  FAIL\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }

echo "============================================"
echo "  backup-sessions.sh Unit Tests"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

# ── 1. Script exists and is executable ─────────
if [[ -x "$SCRIPT" ]]; then
  green "Script is executable"
else
  red "Script is not executable"
fi

# ── 2. Syntax check ───────────────────────────
if bash -n "$SCRIPT" 2>/dev/null; then
  green "Syntax valid (bash -n)"
else
  red "Syntax error"
fi

# ── 3. --help exits 0 and prints usage ────────
HELP_OUT=$(bash "$SCRIPT" --help 2>&1)
HELP_RC=$?
if [[ $HELP_RC -eq 0 ]]; then
  green "--help exits 0"
else
  red "--help exits $HELP_RC (expected 0)"
fi

if echo "$HELP_OUT" | grep -q "Usage:"; then
  green "--help prints usage text"
else
  red "--help missing usage text"
fi

if echo "$HELP_OUT" | grep -q "\-\-compress"; then
  green "--help documents --compress"
else
  red "--help missing --compress documentation"
fi

if echo "$HELP_OUT" | grep -q "\-\-restore"; then
  green "--help documents --restore"
else
  red "--help missing --restore documentation"
fi

# ── 4. Unknown option fails ───────────────────
BOGUS_OUT=$(bash "$SCRIPT" --bogus 2>&1 || true)
if echo "$BOGUS_OUT" | grep -q "Unknown option"; then
  green "Unknown option rejected"
else
  red "Unknown option not rejected"
fi

# ── 5. --restore without path fails ───────────
NOPATH_OUT=$(bash "$SCRIPT" --restore 2>&1 || true)
if echo "$NOPATH_OUT" | grep -q "requires a path"; then
  green "--restore without path shows error"
else
  red "--restore without path missing error message"
fi

# ── 6. --restore with nonexistent path fails ──
BADPATH_OUT=$(bash "$SCRIPT" --restore /nonexistent/path 2>&1 || true)
if echo "$BADPATH_OUT" | grep -q "not found"; then
  green "--restore with bad path shows error"
else
  red "--restore with bad path missing error"
fi

# ── Summary ─────────────────────────────────────
echo ""
echo "============================================"
TOTAL=$((PASS + FAIL))
printf "  Results: \033[32m%d passed\033[0m, \033[31m%d failed\033[0m, %d total\n" "$PASS" "$FAIL" "$TOTAL"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
