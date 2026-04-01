# Fleet Node Tuning System

## Goal
Build a fleet tuning system that reads dispatcher health, calculates optimal node counts, compares actual vs desired, and outputs scaling recommendations. Add a dashboard endpoint to visualize the state.

## Success Criteria
1. `scripts/fleet/fleet-tune.sh` reads /health from dispatcher API
2. Calculates optimal counts: workers = max(pending_tasks * 2, 10), monitors = max(workers / 20, 1), dispatchers = 1
3. Compares actual vs desired node counts
4. Outputs scaling recommendations (add/remove N workers/monitors)
5. `scripts/fleet/tune-config.json` stores tunable params (editable)
6. `/fleet-tune` endpoint on dashboard central-server.js shows current vs desired with color coding (green=matched, yellow=drift, red=critical)
