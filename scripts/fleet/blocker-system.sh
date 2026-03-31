#!/usr/bin/env bash
# blocker-system.sh -- Worker blocker reporting system
# Usage: blocker-system.sh <task-id> <description> [--stack-trace <trace>] [--attempts <json>]
#
# Creates a blocker document, GitHub issue, and notifies the parent manager.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BLOCKERS_DIR="${PROJECT_ROOT}/blockers"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
MANAGER_URL="${FLEET_MANAGER_URL:-http://localhost:5000}"
WORKER_ID="${FLEET_WORKER_ID:-$(hostname)}"
GITHUB_REPO="${FLEET_GITHUB_REPO:-}"  # owner/repo

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
usage() {
    cat <<'USAGE'
Usage: blocker-system.sh <task-id> <description> [options]

Options:
  --stack-trace <text>     Stack trace or error output
  --attempts <json>        JSON array of attempted fixes
  --manager-url <url>      Override FLEET_MANAGER_URL
  --github-repo <repo>     Override FLEET_GITHUB_REPO (owner/repo)
  --worker-id <id>         Override FLEET_WORKER_ID
  --severity <level>       low | medium | high | critical (default: medium)
  --dry-run                Print what would happen without side effects
USAGE
    exit 1
}

[[ $# -lt 2 ]] && usage

TASK_ID="$1"; shift
DESCRIPTION="$1"; shift

STACK_TRACE=""
ATTEMPTS="[]"
SEVERITY="medium"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --stack-trace)  STACK_TRACE="$2"; shift 2 ;;
        --attempts)     ATTEMPTS="$2"; shift 2 ;;
        --manager-url)  MANAGER_URL="$2"; shift 2 ;;
        --github-repo)  GITHUB_REPO="$2"; shift 2 ;;
        --worker-id)    WORKER_ID="$2"; shift 2 ;;
        --severity)     SEVERITY="$2"; shift 2 ;;
        --dry-run)      DRY_RUN=true; shift ;;
        *)              echo "Unknown option: $1"; usage ;;
    esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[blocker-system $(timestamp)] $*"; }

json_escape() {
    python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" <<< "$1"
}

# ---------------------------------------------------------------------------
# 1. Create blocker document
# ---------------------------------------------------------------------------
mkdir -p "$BLOCKERS_DIR"
BLOCKER_FILE="${BLOCKERS_DIR}/${TASK_ID}.json"
CREATED_AT="$(timestamp)"

ESCAPED_DESC=$(json_escape "$DESCRIPTION")
ESCAPED_TRACE=$(json_escape "$STACK_TRACE")

cat > "$BLOCKER_FILE" <<ENDJSON
{
  "task_id": "${TASK_ID}",
  "worker_id": "${WORKER_ID}",
  "description": ${ESCAPED_DESC},
  "stack_trace": ${ESCAPED_TRACE},
  "attempted_fixes": ${ATTEMPTS},
  "severity": "${SEVERITY}",
  "status": "open",
  "created_at": "${CREATED_AT}",
  "resolved_at": null,
  "resolution": null
}
ENDJSON

log "Blocker document created: ${BLOCKER_FILE}"

# ---------------------------------------------------------------------------
# 2. Create GitHub issue (if repo configured)
# ---------------------------------------------------------------------------
ISSUE_URL=""
if [[ -n "$GITHUB_REPO" ]]; then
    ISSUE_TITLE="[Blocker] ${TASK_ID}: ${DESCRIPTION:0:80}"
    ISSUE_BODY="## Blocker Report

**Task ID:** \`${TASK_ID}\`
**Worker:** \`${WORKER_ID}\`
**Severity:** ${SEVERITY}
**Time:** ${CREATED_AT}

### Description
${DESCRIPTION}

### Stack Trace
\`\`\`
${STACK_TRACE:-N/A}
\`\`\`

### Attempted Fixes
\`\`\`json
${ATTEMPTS}
\`\`\`
"

    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY-RUN] Would create issue in ${GITHUB_REPO}: ${ISSUE_TITLE}"
    else
        ISSUE_RESULT=$(gh issue create \
            --repo "$GITHUB_REPO" \
            --title "$ISSUE_TITLE" \
            --body "$ISSUE_BODY" \
            --label "blocker" 2>&1) || {
            log "WARNING: GitHub issue creation failed: ${ISSUE_RESULT}"
            ISSUE_RESULT=""
        }
        if [[ -n "$ISSUE_RESULT" ]]; then
            ISSUE_URL="$ISSUE_RESULT"
            log "GitHub issue created: ${ISSUE_URL}"
            # Update blocker doc with issue URL
            python3 -c "
import json
with open('${BLOCKER_FILE}') as f: d = json.load(f)
d['github_issue'] = '${ISSUE_URL}'
with open('${BLOCKER_FILE}', 'w') as f: json.dump(d, f, indent=2)
"
        fi
    fi
else
    log "No FLEET_GITHUB_REPO set -- skipping GitHub issue"
fi

# ---------------------------------------------------------------------------
# 3. POST to parent manager /api/blocker
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would POST blocker to ${MANAGER_URL}/api/blocker"
else
    PAYLOAD=$(cat "$BLOCKER_FILE")
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        "${MANAGER_URL}/api/blocker" 2>/dev/null) || HTTP_CODE="000"

    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" || "$HTTP_CODE" == "202" ]]; then
        log "Manager notified successfully (HTTP ${HTTP_CODE})"
    else
        log "WARNING: Manager notification failed (HTTP ${HTTP_CODE}) -- blocker saved locally"
    fi
fi

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
echo "$BLOCKER_FILE"
