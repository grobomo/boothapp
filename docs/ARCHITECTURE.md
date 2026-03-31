# BoothApp System Architecture

> AI-powered trade show demo capture and personalized follow-up system.
> Team "Smells Like Machine Learning" -- Hackathon 2026

---

## Table of Contents

1. [System Overview](#system-overview)
2. [End-to-End Demo Flow](#end-to-end-demo-flow)
3. [Component Deep Dive](#component-deep-dive)
4. [S3 Data Contract](#s3-data-contract)
5. [AWS Infrastructure](#aws-infrastructure)
6. [CCC Fleet Architecture](#ccc-fleet-architecture)
7. [Security Model](#security-model)
8. [Key Design Decisions](#key-design-decisions)

---

## System Overview

BoothApp captures everything during a live trade show booth demo -- audio,
clicks, screenshots -- and uses Claude AI to generate a personalized
follow-up package for each visitor. All components communicate through
S3 as the shared data plane. No direct service-to-service calls during
capture.

```
+===========================================================================+
|                          BOOTH (Physical Setup)                           |
|                                                                           |
|  +-------------------+     +------------------------------------------+  |
|  |   Android App     |     |            Demo PC (Windows)             |  |
|  |                   |     |                                          |  |
|  |  * Badge photo    |     |  +----------------+  +----------------+ |  |
|  |  * OCR -> name    |     |  | Chrome Ext     |  | Audio Recorder | |  |
|  |  * Start session  |     |  | (V1-Helper)    |  | (ffmpeg/node)  | |  |
|  |  * End session    |     |  |                |  |                | |  |
|  |                   |     |  | * Click track  |  | * USB mic      | |  |
|  +--------+----------+     |  | * Screenshots  |  | * WAV capture  | |  |
|           |                 |  | * DOM paths    |  | * Auto-detect  | |  |
|           |                 |  +-------+--------+  +-------+--------+ |  |
|           |                 |          |                    |          |  |
|           |                 +----------|--------------------+----------+  |
|           |                            |                    |             |
+===========|============================|====================|=============+
            |                            |                    |
            v                            v                    v
+===========================================================================+
|                         AWS CLOUD (us-east-1)                             |
|                                                                           |
|  +---------------------------------------------------------------------+ |
|  |                    S3: boothapp-sessions-<acct>                      | |
|  |                                                                     | |
|  |  sessions/<id>/                                                     | |
|  |    metadata.json    badge.jpg    commands/                          | |
|  |    clicks/          audio/       transcript/                        | |
|  |    screenshots/     output/      v1-tenant/                        | |
|  +------------------+----------------------------------------------+--+ |
|                     |                                              |     |
|                     v                                              |     |
|  +---------------------------+    +--------------------------------+--+  |
|  | Session Orchestrator      |    |  Analysis Pipeline               |  |
|  | (Lambda)                  |    |                                   |  |
|  |                           |    |  Watcher (polls S3 every 30s)    |  |
|  | * Create/end sessions     |    |       |                          |  |
|  | * State machine           |    |       v                          |  |
|  | * Command queue for PCs   |    |  Correlator (merge timeline)     |  |
|  | * Tenant pool management  |    |       |                          |  |
|  +---------------------------+    |       v                          |  |
|                                   |  Claude / Bedrock                |  |
|                                   |  (2-pass analysis)               |  |
|                                   |       |                          |  |
|                                   |       v                          |  |
|                                   |  Report Generator                |  |
|                                   |  (HTML + JSON + email)           |  |
|                                   +----------------------------------+  |
|                                              |                           |
|                                              v                           |
|  +---------------------------------------------------------------------+ |
|  |  Presenter Dashboard (static HTML on EC2)                           | |
|  |  * Live session monitor    * Session timeline view                  | |
|  |  * SDR review interface    * Worker status (CCC fleet)              | |
|  +---------------------------------------------------------------------+ |
+===========================================================================+
```

---

## End-to-End Demo Flow

```
  Visitor            SE (Sales Engineer)         System
  -------            -------------------         ------
    |                       |                       |
    |  walks up to booth    |                       |
    |  --------------------->                       |
    |                       |                       |
    |                  [1] Snap badge photo          |
    |                  (Android app)                 |
    |                       |                       |
    |                       +-- OCR extract name --->|
    |                       |                       |
    |                       |    [2] Create session  |
    |                       |    metadata.json -> S3 |
    |                       |    badge.jpg -> S3     |
    |                       |                       |
    |                       |    [3] Demo PC detects |
    |                       |    new session (poll)  |
    |                       |    Starts recording    |
    |                       |    + click tracking    |
    |                       |                       |
    |  watches V1 demo      |                       |
    |  asks questions        |                       |
    |  <-------------------->|                       |
    |                       |                       |
    |                  [4] Tap "End Session"          |
    |                  (Android app)                  |
    |                       |                       |
    |                       +-- end command -> S3 -->|
    |                       |                       |
    |                       |    [5] PC uploads:     |
    |                       |    clicks.json         |
    |                       |    screenshots/*.jpg   |
    |                       |    audio/recording.wav |
    |                       |                       |
    |                       |    [6] Transcribe audio|
    |                       |    -> transcript.json  |
    |                       |                       |
    |                       |    [7] Watcher detects |
    |                       |    complete session    |
    |                       |                       |
    |                       |    [8] Claude analyzes:|
    |                       |    Pass 1: Facts       |
    |                       |    Pass 2: Recs        |
    |                       |                       |
    |                       |    [9] Output:         |
    |                       |    summary.html        |
    |                       |    summary.json        |
    |                       |    follow-up-email.html|
    |                       |                       |
    |                  [10] SDR reviews on dashboard  |
    |                       |                       |
    |  receives follow-up   |                       |
    |  <--------------------------------------------|
    |  with V1 tenant link  |                       |
```

---

## Component Deep Dive

### 1. Android App (`android/`)

Native Android app (Kotlin) used by the SE at the booth.

| Feature | Detail |
|---------|--------|
| Badge capture | Camera -> photo -> S3 upload |
| OCR | On-device text extraction from badge photo |
| Session lifecycle | Start/end session buttons |
| QR pairing | Scan QR to pair with specific demo PC |
| Timer | Session duration display |

Creates `metadata.json` and `badge.jpg` in S3, issues start/end commands
via S3 command objects that the demo PC polls.

### 2. Chrome Extension (`extension/`)

Manifest V3 extension running on the demo PC browser during live demos.
Forked from V1EGO click tracker + Blueprint Extra MCP relay.

| Module | File | Purpose |
|--------|------|---------|
| Click tracker | `content.js` | Intercepts all clicks, captures DOM path, coordinates, element info |
| Screenshot | `background.js` | `chrome.tabs.captureVisibleTab()` -- silent, no flash |
| Popup UI | `popup.html/js` | Session status, S3 config, QR code display |
| S3 upload | `background.js` | Batch upload on session end (clicks + screenshots) |

Screenshots are taken on every click AND periodically (configurable interval).
Events are buffered in memory and flushed to S3 as `clicks/clicks.json` and
`screenshots/*.jpg` when the session ends.

Works on V1 console (handles iframes), any Trend Micro web product, or
any browser-based demo.

### 3. Audio Recorder (`audio/`)

Node.js service running on the demo PC. Captures microphone audio via
ffmpeg with DirectShow.

```
audio/
  recorder.js           Main entry -- orchestrates session lifecycle
  lib/
    device-detect.js    Auto-detect USB mic (keyword scoring)
    session-poller.js   Poll S3 for session start/stop signals
    ffmpeg-recorder.js  ffmpeg wrapper with graceful SIGINT stop
    s3-upload.js        Upload WAV to S3
```

**Recording flow:**
1. Polls S3 for active session (every 2s)
2. Session detected -> auto-detect USB mic device
3. Start ffmpeg: `-f dshow -i audio="<device>"` -> WAV 44100Hz stereo
4. Poll for end signal (every 5s)
5. End detected -> SIGINT to ffmpeg -> upload `audio/recording.wav` to S3

**Stop-audio command:** If visitor objects to recording, an empty
`commands/stop-audio` object in S3 triggers immediate graceful stop.

### 4. Transcriber (`audio/transcriber/`)

Converts WAV audio to structured transcript JSON.

| File | Purpose |
|------|---------|
| `convert.js` | WAV -> format conversion for STT input |
| `index.js` | Orchestrate transcription, output `transcript.json` |

Output follows the DATA-CONTRACT schema with timestamped speaker-labeled
segments. Runs post-session (not real-time).

### 5. Session Orchestrator (`infra/session-orchestrator/`)

AWS Lambda (Node.js) managing session lifecycle as a state machine.

**Session states:**
```
  active --> recording --> ended --> processing --> analyzed --> reviewed --> sent
    |                        ^
    +------------------------+  (skip recording if audio not used)
```

**Responsibilities:**
- Create sessions (from Android app trigger)
- Enforce valid state transitions
- Write command objects for demo PCs to poll
- Manage V1 tenant pool (claim tenant for visitor)
- Expose REST API via API Gateway

**Key files:**

| File | Purpose |
|------|---------|
| `orchestrator.js` | State machine + session CRUD |
| `s3.js` | S3 operations (get/put/list/delete) |
| `tenant-pool.js` | V1 tenant claim/release/warm pool |

### 6. Analysis Pipeline (`analysis/`)

The brain of the system. Watches for completed sessions and produces
AI-generated reports.

```
analysis/
  watcher.js            S3 poller (30s interval), health endpoint :8090
  pipeline-run.js       Orchestrate single session analysis
  lib/
    correlator.js       Merge clicks + transcript into unified timeline
    s3.js               S3 session operations
    pipeline.js         Pipeline trigger logic
    notify.js           Notification dispatch
    retry.js            Exponential backoff for Bedrock calls
  engines/
    analyzer.py         2-pass Claude analysis (Python)
    claude_client.py    Anthropic / Bedrock client factory
    prompts.py          System prompts + HTML renderer
    email_template.py   Follow-up email generator
    validator.py        Summary JSON schema validation
  render-report.js      HTML report rendering
  email-report.js       Email template generation
  config/
    v1_features.json    V1 product feature reference for analysis context
```

**Two-pass Claude analysis:**

| Pass | System Prompt | Output |
|------|--------------|--------|
| 1. Factual extraction | Extract facts: features shown, questions asked, interest signals | Structured facts JSON |
| 2. Recommendations | Generate contextual follow-up using facts + V1 feature knowledge | summary.json + follow-up actions |

**Claude client routing:**

```python
if USE_BEDROCK:
    AnthropicBedrock(aws_region='us-east-1')    # Amazon Bedrock
else:
    Anthropic(api_key=RONE_AI_API_KEY)           # Direct API
```

Model: configurable via `ANALYSIS_MODEL` env var (default: `claude-sonnet-4-6`).

**Output artifacts (written to S3):**

| File | Format | Consumer |
|------|--------|----------|
| `output/summary.json` | JSON | Downstream integrations, dashboard |
| `output/summary.html` | HTML | Human-readable report (self-contained, inline CSS) |
| `output/follow-up-email.html` | HTML | Personalized visitor email template |

### 7. Watcher (`analysis/watcher.js`)

Continuously running Node.js process that bridges session completion to
analysis.

**Readiness check (all three must be true):**
1. `metadata.json` has `status == 'completed'`
2. `clicks/clicks.json` exists
3. `transcript/transcript.json` exists

**Claim mechanism:** Writes `output/.analysis-claimed` marker to S3 to
prevent duplicate processing by other watcher instances.

**Health endpoint:** HTTP server on port 8090 for liveness/readiness probes.

**Retry:** Exponential backoff on Bedrock throttling errors (429, 500, 502,
503, 529). Max 3 retries with 5s base delay.

### 8. Presenter Dashboard (`presenter/`)

Static HTML/JS pages served from EC2. No backend framework -- reads
directly from S3 using the AWS SDK for JavaScript.

| Page | File | Purpose |
|------|------|---------|
| Dashboard | `index.html` | Session cards with status, scores, visitor names |
| Timeline | `timeline.html` | Chronological view of session events |
| Live monitor | `live.html` | Real-time session activity display for booth screen |
| Sessions API | `sessions.html` | Session list with filtering |
| Workers | `workers.html` | CCC fleet status (active tasks, PRs) |
| Login | `login.html` | Authentication gate |
| Admin | `admin.html` | Administrative controls |

Dark theme (GitHub-style) with TrendAI branding. Cards show session score,
visitor name, products demonstrated, and key interests.

---

## S3 Data Contract

All components communicate through a single S3 bucket. Each session gets
an isolated prefix. Components only write to their designated paths.

```
boothapp-sessions-<account-id>/
  sessions/
    <session-id>/
    |
    |-- metadata.json                # Android app: visitor info, timestamps, status
    |-- badge.jpg                    # Android app: visitor badge photo
    |
    |-- commands/                    # Orchestrator -> Demo PC command queue
    |   |-- start.json              #   Presence = start recording
    |   |-- end.json                #   Presence = stop recording
    |   +-- stop-audio              #   Presence = stop audio only
    |
    |-- clicks/
    |   +-- clicks.json             # Chrome extension: click events array
    |
    |-- screenshots/
    |   |-- click-001.jpg           # Chrome extension: on-click capture
    |   |-- click-002.jpg
    |   |-- periodic-001.jpg        # Chrome extension: timed capture
    |   +-- ...
    |
    |-- audio/
    |   +-- recording.wav           # Audio recorder: 44100Hz stereo WAV
    |
    |-- transcript/
    |   +-- transcript.json         # Transcriber: speaker-labeled segments
    |
    |-- v1-tenant/
    |   +-- tenant.json             # Orchestrator: V1 tenant URL + credentials
    |
    +-- output/
        |-- .analysis-claimed       # Watcher: duplicate processing guard
        |-- summary.json            # Analyzer: structured session summary
        |-- summary.html            # Analyzer: self-contained HTML report
        |-- follow-up.json          # Analyzer: SDR action items
        +-- follow-up-email.html    # Analyzer: visitor email template
```

### Write Ownership

| Path | Writer | Reader(s) |
|------|--------|-----------|
| `metadata.json`, `badge.jpg` | Android app | All components |
| `commands/*` | Orchestrator (Lambda) | Demo PC (poller) |
| `clicks/*` | Chrome extension | Analysis pipeline |
| `screenshots/*` | Chrome extension | Analysis pipeline |
| `audio/*` | Audio recorder | Transcriber |
| `transcript/*` | Transcriber | Analysis pipeline |
| `v1-tenant/*` | Orchestrator | Analysis pipeline, dashboard |
| `output/*` | Analysis pipeline | Presenter dashboard, SDR team |

### Key Schemas

**metadata.json** -- session identity and lifecycle:
```json
{
  "session_id": "A726594",
  "visitor_name": "Jane Smith",
  "badge_photo": "badge.jpg",
  "started_at": "2026-08-05T14:32:00Z",
  "ended_at": "2026-08-05T14:47:00Z",
  "demo_pc": "booth-pc-3",
  "se_name": "Casey Mondoux",
  "audio_consent": true,
  "status": "completed"
}
```

**summary.json** -- AI analysis output:
```json
{
  "session_id": "A726594",
  "visitor_name": "Jane Smith",
  "products_demonstrated": ["Endpoint Security", "XDR", "Risk Insights"],
  "key_interests": [
    {"topic": "Endpoint policy management", "confidence": "high",
     "evidence": "Asked 3 questions about policy config"}
  ],
  "follow_up_actions": [
    "Send EP policy best practices guide",
    "Schedule deep-dive on XDR custom detection rules"
  ],
  "session_score": 8,
  "executive_summary": "Visitor showed strong interest in...",
  "key_moments": [
    {"timestamp": "00:05:30", "screenshot": "click-012.jpg",
     "description": "Asked about BYOD policy"}
  ]
}
```

### Conventions

- All timestamps UTC ISO-8601
- Screenshots: JPEG quality 60, max 1920x1080
- Audio: WAV 44100Hz stereo
- Session ID: alphanumeric, 6-20 characters
- Any component can READ any file; only WRITE to designated paths
- 90-day lifecycle policy auto-deletes session objects

---

## AWS Infrastructure

All resources in **us-east-1**, account `752266476357`, profile `hackathon`.

### Resource Map

```
+-----------------------------------------------------------------------+
|  AWS Account (us-east-1)                                              |
|                                                                       |
|  +------------------+    +-------------------+    +-----------------+ |
|  | S3               |    | Lambda            |    | EC2             | |
|  |                  |    |                   |    |                 | |
|  | boothapp-        |    | session-          |    | Demo PCs (x6)  | |
|  | sessions-<acct>  |<-->| orchestrator      |    | Windows 2022   | |
|  |                  |    |                   |    | t3.medium       | |
|  | * AES-256 SSE    |    | * Node.js 18      |    | Chrome+Node+   | |
|  | * No public      |    | * API Gateway     |    | ffmpeg          | |
|  |   access         |    |   trigger         |    |                 | |
|  | * 90-day expiry  |    | * 256MB / 30s     |    | Watcher (EC2)  | |
|  | * CORS for       |    +-------------------+    | node watcher.js| |
|  |   chrome-ext     |                             | port 8090      | |
|  | * Versioning off |    +-------------------+    +-----------------+ |
|  +------------------+    | Bedrock           |                        |
|                          |                   |    +-----------------+ |
|                          | claude-sonnet-4-6 |    | API Gateway     | |
|                          | (on-demand)       |    |                 | |
|                          |                   |    | /session/*      | |
|                          | * 2-pass analysis |    | -> Lambda       | |
|                          | * Retry on 429    |    +-----------------+ |
|                          +-------------------+                        |
+-----------------------------------------------------------------------+
```

### S3 Bucket (`s3-session-storage.yaml`)

CloudFormation-deployed with:
- **Encryption:** AES-256 server-side (SSE-S3)
- **Public access:** All four `BlockPublic*` settings enabled
- **CORS:** Allows `chrome-extension://*` origins (PUT/POST/GET/HEAD)
- **Lifecycle:** 90-day expiration on `sessions/` prefix
- **Versioning:** Suspended (not needed for ephemeral session data)

### Lambda: Session Orchestrator

- **Runtime:** Node.js 18
- **Memory:** 256 MB
- **Timeout:** 30 seconds
- **Trigger:** API Gateway (REST)
- **IAM:** Scoped to session bucket read/write only

### EC2: Demo PCs (`demo-pc.yaml`)

CloudFormation template provisions Windows Server 2022 instances:
- **Type:** t3.medium (2 vCPU, 4 GB RAM)
- **AMI:** Latest Windows Server 2022 via SSM parameter
- **Software:** Chrome, Node.js 18, ffmpeg, AWS CLI
- **Network:** VPC 10.100.0.0/16, RDP locked to venue CIDR
- **Storage:** 50 GB EBS

### Bedrock (Claude)

- **Model:** `claude-sonnet-4-6` (configurable via `ANALYSIS_MODEL`)
- **Region:** us-east-1
- **Fallback:** Direct Anthropic API via RONE AI endpoint
- **Retry:** Exponential backoff, 3 attempts, 5s base delay
- **Throttling:** Handles 429/500/502/503/529 gracefully

---

## CCC Fleet Architecture

The codebase is developed by a fleet of Claude Code Container (CCC)
workers coordinated by a dispatcher. This is the "85 developers"
approach to hackathon velocity.

```
+-----------------------------------------------------------------------+
|  CCC Fleet (Claude Code Containers)                                   |
|                                                                       |
|  +-------------------+                                                |
|  | Dispatcher         |    Monitors Teams channel for @mentions       |
|  | (Teams Poller)     |    Creates task files in .claude-tasks/       |
|  |                    |    Assigns to available workers               |
|  +---------+---------+                                                |
|            |                                                          |
|            |  task files (.claude-tasks/*.json)                        |
|            |                                                          |
|  +---------v---------------------------------------------------+      |
|  |                    Worker Pool                               |     |
|  |                                                              |     |
|  |  +----------+  +----------+  +----------+     +----------+  |     |
|  |  | Worker 1 |  | Worker 2 |  | Worker 3 | ... | Worker N |  |     |
|  |  | (CCC pod)|  | (CCC pod)|  | (CCC pod)|     | (CCC pod)|  |     |
|  |  +----------+  +----------+  +----------+     +----------+  |     |
|  |                                                              |     |
|  |  Each worker:                                                |     |
|  |  * Picks ONE task from .claude-tasks/                        |     |
|  |  * Reads CLAUDE.md + DATA-CONTRACT.md for context            |     |
|  |  * Plans sub-steps, creates feature branches                 |     |
|  |  * One small PR per sub-step (auto-merge enabled)            |     |
|  |  * Updates task file with progress                           |     |
|  |  * Is ephemeral -- can be destroyed and replaced anytime     |     |
|  +--------------------------------------------------------------+     |
|                                                                       |
|  +-------------------+    +-------------------+                       |
|  | Golden Image      |    | ECR Registry      |                       |
|  | (Docker)          |    |                   |                       |
|  |                   |    | Stores CCC images |                       |
|  | * Claude Code CLI |    | with all tools    |                       |
|  | * Node.js 18      |    | pre-installed     |                       |
|  | * Python 3.11     |    |                   |                       |
|  | * AWS CLI         |    +-------------------+                       |
|  | * gh CLI          |                                                |
|  | * Git             |                                                |
|  +-------------------+                                                |
+-----------------------------------------------------------------------+
```

### How It Works

1. **Dispatcher** polls a Microsoft Teams channel for @Claude mentions
2. Each mention becomes a task file in `.claude-tasks/` (committed to repo)
3. Workers pull from `main`, find unclaimed tasks, claim one
4. Worker breaks the task into sub-steps, creates feature branches
5. Each sub-step produces one focused PR (auto-merge, squash strategy)
6. Worker updates the task file with progress after each sub-step
7. When all sub-steps are done, worker marks task `completed`

### Task Lifecycle

```
  pending --> in_progress --> completed
                  |
                  +--> blocked (needs human)
                  |
                  +--> failed (unrecoverable)
```

### Worker Properties

| Property | Detail |
|----------|--------|
| Ephemeral | Can be destroyed anytime; all state lives in git |
| Generic | Any worker picks up any task; no specialization |
| Self-documenting | Research notes, decisions, blockers go in task files |
| Small PRs | One sub-step = one PR; branches auto-delete after merge |
| Crash-resilient | Next worker reads task file, finds where previous worker stopped |

### Task File Format

```json
{
  "id": "ana-03-report",
  "title": "HTML Report Generator",
  "status": "in_progress",
  "assigned_worker": "ccc-pod-042",
  "substeps": [
    {"id": "template", "title": "Create HTML template",
     "status": "completed", "pr": 187},
    {"id": "render",   "title": "Render engine",
     "status": "in_progress", "pr": null}
  ]
}
```

### Golden Image

Docker image stored in ECR with all development tools pre-installed:

| Tool | Version | Purpose |
|------|---------|---------|
| Claude Code CLI | latest | AI-powered development |
| Node.js | 18 | Extension, audio, infra, analysis |
| Python | 3.11 | Analysis engine (Claude API) |
| AWS CLI | v2 | S3 operations, Bedrock access |
| gh CLI | latest | PR creation, repo operations |
| Git | latest | Version control |

### Fleet Monitoring

The `presenter/workers.html` dashboard shows:
- Active workers and their current tasks
- Recent PRs merged to main
- Task completion velocity

---

## Security Model

### Credential Management

| Secret | Storage | Access |
|--------|---------|--------|
| AWS credentials | OS credential store (profile `hackathon`) | CLI, never in code |
| Bedrock API | IAM role via AWS profile | Watcher process only |
| RONE AI API key | Environment variable | Analysis pipeline only |
| GitHub tokens | OS credential store (`gh auth`) | CCC workers for PRs |

### S3 Bucket Security

- **No public access:** All four `BlockPublic*` settings enabled
- **Server-side encryption:** AES-256 (SSE-S3) on all objects
- **CORS:** Restricted to `chrome-extension://*` origins only
- **IAM:** Per-workstream roles with least-privilege:

| Role | Allowed Operations |
|------|-------------------|
| Extension | `PutObject` on `clicks/*`, `screenshots/*` |
| Audio | `PutObject` on `audio/*` |
| Orchestrator | `*Object` on `metadata.json`, `commands/*`, `v1-tenant/*` |
| Analysis | `GetObject` on `*`, `PutObject` on `output/*` |
| App | `PutObject` on `metadata.json`, `badge.jpg`; `GetObject` on `commands/*` |

### Network Security

- **Demo PCs:** VPC-isolated (10.100.0.0/16), RDP locked to venue CIDR
- **Lambda:** AWS-managed VPC, behind API Gateway (no direct exposure)
- **Watcher EC2:** Security group allows only port 8090 from VPC CIDR
- **S3:** VPC endpoint for private traffic (no internet hop for EC2<->S3)

### Data Protection

- **Session data retention:** 90-day auto-expiration via S3 lifecycle
- **Audio consent:** `metadata.json` tracks `audio_consent` flag;
  recorder respects `commands/stop-audio` for immediate halt
- **No PII in code:** Visitor names exist only in S3 session data
- **Git secrets scanning:** GitHub Actions `secret-scan.yml` on every push

### CI/CD Security

- **Secret scan on every push:** Checks for AWS keys, tokens, passwords,
  subscription IDs, personal paths
- **Squash merge:** Feature branches deleted after merge, clean history
- **No credentials in repo:** AWS profile uses OS store; `.env` in `.gitignore`

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **S3 as shared bus** | Decouples all components. No service-to-service calls during capture. Components develop and test independently. |
| **Polling over events** | S3 event notifications require Lambda plumbing. Polling every 1-30s is simpler, reliable, and fast enough for demo latency. |
| **Stateless orchestrator** | Session state lives in S3 (`metadata.json` + `state.json`). Lambda can be replaced without losing state. |
| **Two-pass Claude analysis** | Pass 1 extracts facts objectively. Pass 2 generates recommendations with product context. Separation improves quality. |
| **Batch upload on session end** | Per-click upload would hammer S3 during demos. Buffer locally, flush on end -- simpler and cheaper. |
| **WAV over compressed audio** | Lossless capture preserves transcription accuracy. Storage cost is negligible; quality matters for speaker ID. |
| **Chrome extension over screen recording** | Structured click data (DOM paths, element info) is far more useful than raw video pixels. Screenshots add visual context. |
| **CCC fleet for development** | Parallel workers with auto-merge ship features in hours. Ephemeral workers + task files = zero coordination overhead. |
| **Self-contained HTML reports** | Inline CSS, no external dependencies. Reports can be emailed, viewed offline, or archived without broken links. |
| **State machine for sessions** | Enforces valid transitions (`active->recording->ended->...`). Prevents race conditions between components writing to same session. |
