#!/usr/bin/env bash
# record-failure.sh -- Record a task failure for blocker-gate tracking
# Usage: record-failure.sh <task-id> <tool-name> [error-message]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BLOCKERS_DIR="${PROJECT_ROOT}/blockers"

[[ $# -lt 2 ]] && { echo "Usage: record-failure.sh <task-id> <tool-name> [error-msg]"; exit 1; }

TASK_ID="$1"
TOOL_NAME="$2"
ERROR_MSG="${3:-}"

mkdir -p "$BLOCKERS_DIR"
FAILURE_FILE="${BLOCKERS_DIR}/${TASK_ID}-failures.json"

python3 -c "
import json, sys
from datetime import datetime, timezone

path = '${FAILURE_FILE}'
try:
    with open(path) as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    data = {'count': 0, 'last_tool': '', 'tools': [], 'created_at': None, 'errors': []}

data['count'] += 1
data['last_tool'] = '${TOOL_NAME}'
data['tools'].append('${TOOL_NAME}')
data['errors'].append({'tool': '${TOOL_NAME}', 'error': '''${ERROR_MSG}''', 'timestamp': datetime.now(timezone.utc).isoformat()})
if not data['created_at']:
    data['created_at'] = datetime.now(timezone.utc).isoformat()

with open(path, 'w') as f:
    json.dump(data, f, indent=2)

print(f'Failure #{data[\"count\"]} recorded for task ${TASK_ID}')
"
