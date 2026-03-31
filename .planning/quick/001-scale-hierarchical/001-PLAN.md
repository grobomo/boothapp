# Plan: Hierarchical Fleet Deployment Scripts

## Goal
Create `scripts/fleet/scale-hierarchical.sh` and `scripts/fleet/test-hierarchy.sh` for deploying and testing a multi-tier hierarchical fleet of analysis workers.

## Success Criteria
1. `scale-hierarchical.sh <worker_count>` calculates tier counts: T3=ceil(workers/5), T2=ceil(T3/5), T1=ceil(T2/5)
2. Deploys tiers in order: T1 first, then T2 (registered to T1), then T3 (registered to T2), then workers (registered to T3)
3. Uses `deploy-stack.sh` for each instance deployment
4. Batches of 20 parallel deploys per tier
5. After each tier completes, collects IPs and registers children with parents via POST /api/register
6. Generates `fleet-hierarchy.json` mapping the full tree
7. `test-hierarchy.sh` deploys mini hierarchy (1 T1 + 2 T2 + 4 T3 + 8 workers)
8. Test script submits a task at the top and verifies it routes down to a worker and completes

## Approach
- Create `scripts/fleet/deploy-stack.sh` as the per-instance CF deployment wrapper
- Create `scripts/fleet/lib/fleet-helpers.sh` for shared functions (ceil, tier calc, etc.)
- Create `scripts/fleet/scale-hierarchical.sh` as the main orchestrator
- Create `scripts/fleet/test-hierarchy.sh` as the integration test
