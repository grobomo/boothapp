# Summary: Hierarchical Fleet Deployment Scripts

## What was done

Created `scripts/fleet/` with 4 files:

1. **`scale-hierarchical.sh`** -- Main orchestrator. Takes `<worker_count>`, calculates tier counts using ceil(n/5), deploys T1->T2->T3->workers in order with batches of 20 parallel deploys. After each tier completes, collects IPs and registers children with parents via POST /api/register. Generates `fleet-hierarchy.json`.

2. **`test-hierarchy.sh`** -- Integration test. Deploys mini hierarchy (8 workers = 1 T1 + 1 T2 + 2 T3 + 8 workers = 12 nodes), validates the hierarchy file structure, submits a task at T1, and verifies it routes down to a worker and completes. Supports `--skip-deploy`, `--cleanup` flags.

3. **`deploy-stack.sh`** -- Per-instance CF deployment wrapper. Deploys a single CloudFormation stack with tier and instance type parameters.

4. **`lib/fleet-helpers.sh`** -- Shared functions: ceil_div, calc_tiers, wait_for_stack, get_stack_ip, register_child, deploy_batch, wait_and_collect_ips, assign_round_robin.

5. **`fleet-node.cfn.yaml`** -- CloudFormation template for fleet nodes. Deploys EC2 with a Node.js fleet agent that handles /api/health, /api/register, /api/task (with hierarchical delegation), and /api/task/:id (with recursive status lookup).

## Verification

- All 4 shell scripts pass `bash -n` syntax check
- CFN template parses correctly with all Resources/Outputs/Parameters
- Tier math verified: 8->1+1+2, 25->1+1+5, 100->1+4+20
- Help text works for both main scripts
