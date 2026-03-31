#!/usr/bin/env bash
# verify-teams-webhook.sh -- Validate Teams webhook configuration
# Checks env vars, GitHub token, label, and server reachability.
set -euo pipefail

# Load .env if present
ENV_FILE="${1:-.env}"
if [ -f "$ENV_FILE" ]; then
  echo "Loading env from $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PASS=0
FAIL=0
WARN=0

pass() { PASS=$((PASS + 1)); echo "  [OK]   $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
warn() { WARN=$((WARN + 1)); echo "  [WARN] $1"; }

echo ""
echo "=== Teams Webhook Configuration Check ==="
echo ""

# -------------------------------------------------------------------
# 1. Environment variables
# -------------------------------------------------------------------
echo "--- Environment Variables ---"

if [ -n "${TEAMS_WEBHOOK_SECRET:-}" ]; then
  pass "TEAMS_WEBHOOK_SECRET is set"
else
  fail "TEAMS_WEBHOOK_SECRET is not set"
  echo "         Get this from Teams when you create the outgoing webhook."
  echo "         See: docs/TEAMS-WEBHOOK-SETUP.md Step 4"
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
  pass "GITHUB_TOKEN is set"
else
  fail "GITHUB_TOKEN is not set"
  echo "         Create one at https://github.com/settings/tokens with 'repo' scope."
  echo "         See: docs/TEAMS-WEBHOOK-SETUP.md Step 1"
fi

GITHUB_REPO="${GITHUB_REPO:-altarr/boothapp}"
echo "  [INFO] GITHUB_REPO = $GITHUB_REPO"
echo ""

# -------------------------------------------------------------------
# 2. GitHub token validation
# -------------------------------------------------------------------
echo "--- GitHub Token ---"

if [ -n "${GITHUB_TOKEN:-}" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$GITHUB_REPO" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ]; then
    pass "Token can access $GITHUB_REPO"
  elif [ "$HTTP_CODE" = "401" ]; then
    fail "Token is invalid or expired"
    echo "         Generate a new one at https://github.com/settings/tokens"
  elif [ "$HTTP_CODE" = "404" ]; then
    fail "Repo $GITHUB_REPO not found (or token lacks access)"
  elif [ "$HTTP_CODE" = "000" ]; then
    warn "Could not reach api.github.com (network issue?)"
  else
    warn "Unexpected HTTP $HTTP_CODE from GitHub API"
  fi
else
  echo "  [SKIP] Cannot validate token (not set)"
fi
echo ""

# -------------------------------------------------------------------
# 3. from-teams label
# -------------------------------------------------------------------
echo "--- GitHub Label ---"

if [ -n "${GITHUB_TOKEN:-}" ]; then
  LABEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$GITHUB_REPO/labels/from-teams" 2>/dev/null || echo "000")

  if [ "$LABEL_CODE" = "200" ]; then
    pass "'from-teams' label exists"
  elif [ "$LABEL_CODE" = "404" ]; then
    echo "  [INFO] Creating 'from-teams' label..."
    CREATE_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$GITHUB_REPO/labels" \
      -d '{"name":"from-teams","color":"0078D4","description":"Issue created from Microsoft Teams"}' \
      2>/dev/null || echo "000")
    if [ "$CREATE_CODE" = "201" ]; then
      pass "Created 'from-teams' label"
    else
      warn "Could not create label (HTTP $CREATE_CODE). Create it manually in GitHub."
    fi
  else
    warn "Could not check label (HTTP $LABEL_CODE)"
  fi
else
  echo "  [SKIP] Cannot check label (token not set)"
fi
echo ""

# -------------------------------------------------------------------
# 4. Presenter server reachability (local only)
# -------------------------------------------------------------------
echo "--- Presenter Server ---"

SERVER_PORT="${PORT:-3000}"
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:$SERVER_PORT/api/health" 2>/dev/null || echo "000")

if [ "$HEALTH" = "200" ]; then
  pass "Presenter server running on port $SERVER_PORT"
else
  warn "Presenter server not reachable on localhost:$SERVER_PORT"
  echo "         Start it with: npm run start:presenter"
  echo "         (This is OK if you haven't started it yet)"
fi
echo ""

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
echo "=== Summary ==="
echo "  Passed:   $PASS"
echo "  Failed:   $FAIL"
echo "  Warnings: $WARN"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Fix the failures above, then re-run this script."
  echo "Full guide: docs/TEAMS-WEBHOOK-SETUP.md"
  exit 1
fi

if [ "$WARN" -gt 0 ]; then
  echo "Warnings are non-blocking but worth checking."
fi

echo "Configuration looks good. Follow docs/TEAMS-WEBHOOK-SETUP.md Step 4 to create"
echo "the outgoing webhook in Teams (if you haven't already)."
exit 0
