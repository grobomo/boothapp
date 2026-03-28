# Workstream D: Backend Infrastructure

## Owner Pool
CCC workers assigned to `infra/` only touch files in this directory.

## What This Does
Manages the shared cloud platform and V1 tenant lifecycle for booth demos:
1. **V1 tenant pool** — provision, warm, claim, preserve, expire
2. **Shared AWS environment** — one persistent AWS account with generic infrastructure that ANY V1 demo tenant can connect to (EC2 endpoints, S3 buckets, EKS clusters, sample data). Not per-session — reusable across all demos.
3. **V1 module connectors** — pre-built configs for connecting V1 modules (Cloud Accounts, Service Gateway, Endpoint agents, CSPM, Container Security) from any demo tenant to the shared AWS environment
4. **S3 session storage** — bucket structure, lifecycle policies for demo session data
5. **Session orchestration** — coordinate start/stop across extension + audio
6. **Demo PC polling service** — S3-based command queue for each demo PC

## Outputs
- V1 tenants (provisioned and ready)
- S3 buckets (configured with proper structure)
- `v1-tenant/tenant.json` in each session folder
- Session commands in S3 for demo PCs to poll

## Inputs
- Session creation events (from Android app / dispatcher)
- Session end events (from Android app)
- V1 provisioning API / automation

## Tasks
See `.claude-tasks/` for task files prefixed with `inf-`

## Shared AWS Environment (persistent, not per-session)
The hackathon AWS account has ONE environment that all V1 demo tenants connect to:
- **EC2 instances** — sample endpoints with Trend agents installed (Windows, Linux)
- **EKS cluster** — sample containerized workloads for Container Security demos
- **S3 buckets** — sample data, log sources
- **VPC** — network topology for Network Security demos
- **Sample threat data** — pre-staged detections, alerts, suspicious files for demo scenarios

When a new V1 tenant is provisioned, it connects to this shared environment via:
- Cloud Account connection (AWS account ID)
- Service Gateway (if needed)
- Pre-installed agents that register to the new tenant's V1 console

This means every visitor sees real data, real endpoints, real detections — not a static slideshow.

## Key Decisions
- V1 tenant pool: 6 active + 6 warming + 3 buffer = 15 total
- Tenants preserved 30 days after demo
- Auto-replenish: start provisioning replacement as soon as tenant is claimed
- **Shared AWS infra is persistent** — same EC2s, same EKS, same data across all demos
- **V1 tenants connect to shared infra** — each tenant sees the same environment but is isolated
- **Generic sample data** — not customer-specific, works for any demo scenario
- S3 session folders created by infra, populated by other workstreams
- Demo PC polls S3 every 1s for session start, every 5s for session end
- AWS profile: `hackathon` (us-east-1, account 752266476357)
- Must have load simulation tests before any conference
- Must handle provisioning failures gracefully (retry, alert, never run out)
