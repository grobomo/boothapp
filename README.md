# BoothApp

```
 ____              _   _       _
| __ )  ___   ___ | |_| |__   / \   _ __  _ __
|  _ \ / _ \ / _ \| __| '_ \ / _ \ | '_ \| '_ \
| |_) | (_) | (_) | |_| | | / ___ \| |_) | |_) |
|____/ \___/ \___/ \__|_| |_/_/   \_\ .__/| .__/
                                     |_|   |_|
```

### AI-Powered Trade Show Demo Capture & Personalized Follow-Up

> **Record everything. Analyze instantly. Follow up personally.**

---

## The Problem

At trade shows, Sales Engineers give 50+ live demos per day. Within an hour,
details blur together. Who asked about endpoint policy? Who was comparing
with CrowdStrike? What did they actually see? Follow-up emails become
generic -- "Great meeting you at Black Hat!" -- and deals go cold.

## The Solution

BoothApp captures **everything** during a live booth demo -- audio
conversation, every click and screenshot in the product UI, and the
visitor's badge -- then uses **Claude AI** to generate a personalized
follow-up package within minutes of the visitor walking away.

The visitor receives an email with:
- A summary of exactly what they saw and asked about
- Their specific interest areas and buying signals
- Recommended next steps tailored to their questions
- A link to their own preserved product tenant to keep exploring

**No demo forgotten. No visitor left behind.**

---

## How It Works

```
 VISITOR ARRIVES                                           VISITOR LEAVES
      |                                                         |
      v                                                         v
 +----------+    +-------------------------------------------+
 | Badge    |    |              DEMO PC                      |
 | Scanner  |    |                                           |
 | (phone)  |    |  +-------------+     +-----------------+  |
 |          |    |  | Chrome Ext  |     | Audio Recorder  |  |
 | * photo  |    |  | V1-Helper   |     | ffmpeg + node   |  |
 | * OCR    |    |  |             |     |                 |  |
 | * name   |    |  | * clicks    |     | * USB mic       |  |
 +----+-----+    |  | * screens   |     | * WAV capture   |  |
      |          |  | * DOM paths |     | * auto-detect   |  |
      |          |  +------+------+     +--------+--------+  |
      |          +---------|---------------------|------------+
      |                    |                     |
      +--------------------+---------------------+
                           |
                           v
               +-----------+-----------+
               |                       |
               |       AWS S3          |
               |   sessions/<id>/      |
               |                       |
               |  metadata.json        |
               |  clicks/clicks.json   |
               |  audio/recording.wav  |
               |  transcript/*.json    |
               |  screenshots/*.jpg    |
               |                       |
               +-----------+-----------+
                           |
               +-----------+-----------+
               |       WATCHER         |
               |   polls every 30s     |
               |   detects completed   |
               |   sessions            |
               +-----------+-----------+
                           |
               +-----------+-----------+
               |    ANALYSIS PIPELINE  |
               |                       |
               |  1. Correlator        |
               |     merge clicks +    |
               |     audio by time     |
               |                       |
               |  2. Claude AI         |
               |     two-pass analysis |
               |     * extract facts   |
               |     * generate recs   |
               |                       |
               |  3. Report Renderer   |
               |     HTML + JSON       |
               +-----------+-----------+
                           |
                           v
               +-----------+-----------+
               |    PRESENTER          |
               |    DASHBOARD          |
               |                       |
               |  * session timeline   |
               |  * engagement scores  |
               |  * screenshot gallery |
               |  * follow-up actions  |
               |  * email generator    |
               +-----------------------+
```

**Pipeline:** `badge + clicks + audio --> S3 --> watcher --> correlator --> Claude --> report --> dashboard`

**Status flow:** `active` --> `ended` --> `analyzing` --> `complete`

---

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.9+ with pip
- AWS CLI (configured with `hackathon` profile)
- Chrome browser
- ffmpeg (for audio capture)

### 1. Clone & Install

```bash
git clone https://github.com/altarr/boothapp.git
cd boothapp
npm install
cd analysis && npm install && pip install -r requirements.txt && cd ..
cd audio && npm install && cd ..
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env -- add your AWS credentials and Claude API key
```

### 3. Load the Chrome Extension

```
chrome://extensions --> Enable Developer Mode --> Load Unpacked --> select extension/
```

### 4. Run the Demo Simulation

No hardware needed -- generates synthetic session data and runs the full pipeline:

```bash
bash scripts/run-demo-simulation.sh
```

### 5. Start Individual Services

```bash
node infra/session-orchestrator/orchestrator.js   # Session API         :3000
node analysis/watcher.js                          # S3 poller + trigger :8090
node presenter/server.js                          # Dashboard UI        :3001
node audio/recorder.js                            # Mic capture (demo PC)
```

### 6. Run Tests

```bash
npm test                         # End-to-end pipeline test
bash scripts/health-check.sh     # Verify all services
bash scripts/preflight.sh        # Pre-demo checklist
```

---

## Components

### Chrome Extension (`extension/`)

Manifest V3 extension that silently captures everything during a product demo.

| Feature | How |
|---------|-----|
| **Click tracking** | Intercepts all clicks, logs DOM path + element metadata + coordinates |
| **Silent screenshots** | `captureVisibleTab()` on every click -- no flash, no delay |
| **Periodic screenshots** | Fallback capture every N seconds for non-click navigation |
| **Session awareness** | Polls S3 for session start/stop commands from the badge scanner app |
| **Batch upload** | Uploads all captured data to S3 when session ends |
| **Status popup** | Live indicator showing session state, click count, screenshot count |

Key files: `content.js` (click interception + DOM capture), `background.js` (screenshot + upload orchestration), `popup.js` (status UI)

---

### Audio Recorder (`audio/`)

Session-triggered audio capture using ffmpeg on the demo PC.

| Feature | How |
|---------|-----|
| **Auto-detect USB mic** | Scans dshow devices for keywords: usb, wireless, mic, yeti, rode, shure |
| **Session-triggered** | Starts/stops automatically based on S3 session lifecycle |
| **Graceful stop** | SIGINT to ffmpeg -- WAV file is always valid, never truncated |
| **Stop-audio command** | If visitor objects to recording, drop a `commands/stop-audio` file in S3 |
| **Transcription** | Post-session transcription via Whisper/cloud STT, outputs timestamped JSON |

Output: `audio/recording.wav` (44100Hz stereo) + `transcript/transcript.json`

Key files: `recorder.js` (orchestrator), `lib/device-detect.js` (mic finder), `lib/ffmpeg-recorder.js` (ffmpeg wrapper), `transcriber/index.js` (STT pipeline)

---

### Watcher (`analysis/watcher.js`)

S3 polling service that detects completed sessions and triggers the analysis pipeline.

- Polls every 30 seconds (configurable via `POLL_INTERVAL_SECONDS`)
- A session is "ready" when `metadata.json` has `status: completed` AND both `clicks.json` and `transcript.json` exist
- Claims sessions with an `.analysis-claimed` marker to prevent duplicate processing
- Spawns `pipeline-run.js` for each ready session
- Exposes health check on port 8090

---

### Analysis Pipeline (`analysis/`)

The brain of BoothApp. Correlates all captured data and produces AI-powered insights.

```
clicks.json + transcript.json
            |
            v
    +-------+-------+
    |   Correlator   |    Merges clicks + transcript into unified
    |   (lib/)       |    timeline sorted by timestamp
    +-------+-------+
            |
            v
    +-------+-------+
    |   Claude AI    |    Two-pass analysis:
    |   (analyze.py) |    Pass 1: Extract facts (what shown, questions asked)
    |                |    Pass 2: Generate recommendations + follow-up
    +-------+-------+
            |
            v
    +-------+-------+
    |   Renderer     |    Outputs:
    |                |    * summary.html (self-contained, email-ready)
    |                |    * summary.json (structured data)
    |                |    * follow-up.json (SDR action items)
    +----------------+
```

Key files: `pipeline-run.js` (orchestrator), `lib/correlator.js` (timeline merge), `analyze.py` (Claude two-pass), `render-report.js` (HTML generation), `email-report.js` (email-ready output)

---

### Presenter Dashboard (`presenter/`)

Web UI for SEs and SDRs to review session results and take action.

| Page | Purpose |
|------|---------|
| `index.html` | Live session dashboard -- active demos, recent completions |
| `session-viewer.html` | Deep dive into a single session with timeline + screenshots |
| `sessions.html` | Session list with search, filter, engagement scores |
| `analytics.html` | Aggregate metrics -- word cloud, conversion indicators |
| `gallery.html` | Screenshot gallery across sessions |
| `heatmap.html` | Visitor engagement heatmap |
| `email-generator.html` | Generate follow-up email from session data |
| `roi-calculator.html` | XDR ROI calculator for demo conversations |
| `feedback.html` | Visitor feedback form (post-demo) |
| `admin.html` | System configuration and health monitoring |
| `demo-script.html` | Judge-friendly demo walkthrough with talking points |

Server: `server.js` (Express, port 3001) with auth middleware and rate limiting.

---

## S3 Data Contract

All components communicate through S3. No direct service-to-service calls. Each
component writes to its own files and reads from others.

```
sessions/<session-id>/
|
+-- metadata.json              # Badge scanner: visitor name, SE, timestamps, status
+-- badge.jpg                  # Badge scanner: photo of visitor badge
|
+-- clicks/
|   +-- clicks.json            # Extension: click events with DOM paths + element metadata
|
+-- screenshots/
|   +-- click-001.jpg          # Extension: screenshot on click (silent capture)
|   +-- periodic-001.jpg       # Extension: timed screenshot (fallback)
|
+-- audio/
|   +-- recording.wav          # Audio recorder: 44100Hz stereo WAV
|
+-- transcript/
|   +-- transcript.json        # Transcriber: timestamped speaker segments
|
+-- feedback.json              # Presenter: visitor feedback form submission
|
+-- output/
    +-- summary.html           # Analysis: self-contained HTML report
    +-- summary.json           # Analysis: structured insights + engagement score
    +-- follow-up.json         # Analysis: SDR action items + priority + tags
    +-- follow-up-email.html   # Analysis: email-ready HTML for visitor
```

**Rules:**
- All timestamps UTC ISO-8601
- Screenshots JPEG, quality 60, max 1920x1080
- Audio WAV, 44100Hz, stereo
- Session IDs: alphanumeric, 6-10 characters
- Any component can READ any file; only WRITE to your own

Full schema definitions: [DATA-CONTRACT.md](DATA-CONTRACT.md)

---

## Environment Variables

```bash
# AWS
AWS_REGION=us-east-1
AWS_PROFILE=hackathon
S3_BUCKET=boothapp-sessions-<account-id>

# Analysis
ANALYSIS_MODEL=claude-sonnet-4-6     # Claude model for analysis
USE_BEDROCK=false                     # true = use AWS Bedrock, false = direct API
ANTHROPIC_API_KEY=                    # Required if USE_BEDROCK=false

# Watcher
POLL_INTERVAL_SECONDS=30              # S3 polling frequency
HEALTH_PORT=8090                      # Health check endpoint port

# Audio
AUDIO_DEVICE=                         # Force specific mic (auto-detected if unset)

# Notifications
WEBHOOK_URL=                          # Teams/Slack webhook for alerts

# Teams-to-GitHub Issues (see docs/TEAMS-WEBHOOK-SETUP.md)
TEAMS_WEBHOOK_SECRET=                 # HMAC secret from Teams outgoing webhook
GITHUB_TOKEN=                         # GitHub PAT with repo scope
GITHUB_REPO=altarr/boothapp          # Target repo for issues
```

See [.env.example](.env.example) for the full list.

### Teams Channel Integration

Team members can create GitHub issues by posting messages in a Teams channel.
See **[docs/TEAMS-WEBHOOK-SETUP.md](docs/TEAMS-WEBHOOK-SETUP.md)** for the
complete setup guide, or run the quick checker:

```bash
bash scripts/verify-teams-webhook.sh
```

---

## Deployment

### Demo PC Setup (per booth station)

```bash
# 1. Install dependencies
npm install && cd analysis && npm install && pip install -r requirements.txt && cd ..
cd audio && npm install && cd ..

# 2. Load Chrome extension
#    chrome://extensions -> Developer Mode -> Load Unpacked -> extension/

# 3. Configure environment
cp .env.example .env
# Set S3_BUCKET, AWS credentials, ANTHROPIC_API_KEY

# 4. Run preflight check
bash scripts/preflight.sh

# 5. Start services
node audio/recorder.js &
node analysis/watcher.js &
node presenter/server.js &
```

### AWS Infrastructure

```bash
# Deploy S3 bucket with CloudFormation
aws cloudformation deploy \
  --template-file infra/s3-session-storage.yaml \
  --stack-name boothapp-sessions \
  --profile hackathon \
  --region us-east-1
```

### Pre-Show Checklist

```bash
bash scripts/preflight.sh        # Verify AWS, Chrome ext, audio, all green
bash scripts/demo-checklist.sh    # Walk through physical setup
bash scripts/health-check.sh      # Verify running services
```

---

## Project Structure

```
boothapp/
+-- extension/          Chrome extension (Manifest V3)
|   +-- manifest.json       Extension config
|   +-- content.js          Click interception + DOM capture
|   +-- background.js       Screenshot + upload orchestration
|   +-- popup.html/js       Session status UI
|
+-- audio/              Audio capture + transcription
|   +-- recorder.js         Session-triggered ffmpeg recorder
|   +-- transcriber/        Whisper/cloud STT pipeline
|   +-- lib/                Device detection, S3 polling, ffmpeg wrapper
|
+-- analysis/           AI analysis pipeline
|   +-- watcher.js          S3 poller -- detects completed sessions
|   +-- pipeline-run.js     End-to-end session processor
|   +-- analyze.py          Claude two-pass analysis engine
|   +-- lib/correlator.js   Click + audio timeline merger
|   +-- render-report.js    HTML report generator
|   +-- email-report.js     Email-ready output
|   +-- engines/            Analysis template definitions
|   +-- templates/          HTML report templates
|
+-- presenter/          Dashboard web UI
|   +-- server.js           Express server (port 3001)
|   +-- index.html          Live session dashboard
|   +-- session-viewer.html Session deep-dive
|   +-- analytics.html      Aggregate metrics
|   +-- 20+ more pages      Gallery, heatmap, ROI calc, email gen, etc.
|
+-- infra/              AWS infrastructure
|   +-- s3-session-storage.yaml  CloudFormation template
|   +-- session-orchestrator/    Session lifecycle API
|   +-- config.js                Shared AWS config
|
+-- demo/               Demo landing pages
|   +-- landing/            Booth welcome screen
|   +-- index.html          Demo status page
|
+-- scripts/            Operations
|   +-- run-demo-simulation.sh   Full pipeline with synthetic data
|   +-- preflight.sh             Pre-demo verification
|   +-- health-check.sh          Service health checks
|   +-- deploy-presenter.sh      Dashboard deployment
|
+-- docs/               Documentation
|   +-- ARCHITECTURE.md     Full system architecture
|   +-- DEMO-WALKTHROUGH.md Demo script for trade shows
|   +-- DEMO-QUICK-START.md 5-minute setup guide
|   +-- PRESENTER-GUIDE.md  Dashboard user guide
|
+-- tests/              Test suites
|   +-- e2e/                End-to-end pipeline tests
|   +-- unit/               Component unit tests
|   +-- integration/        Cross-component tests
|
+-- DATA-CONTRACT.md    S3 schema definitions (the API between components)
+-- CHANGELOG.md        All changes by date
+-- PROJECT-PLAN.md     Architecture + integration map
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Capture** | Chrome Extension (Manifest V3) | Silent click + screenshot capture inside any web app |
| **Audio** | ffmpeg + Node.js | Reliable cross-platform audio with graceful stop |
| **Transcription** | Whisper / AWS Transcribe | Timestamped speaker-segmented transcripts |
| **Storage** | AWS S3 + CloudFormation | Decoupled data plane -- all components read/write S3 |
| **Analysis** | Python + Claude API | Two-pass analysis: fact extraction then recommendations |
| **Correlation** | Node.js | Merge click + audio timelines by timestamp |
| **Reports** | HTML + inline CSS | Self-contained email-ready reports, no external deps |
| **Dashboard** | Express + vanilla JS | Lightweight presenter UI with live updates |
| **Orchestration** | Express + S3 polling | Session lifecycle management |
| **Security** | Helmet + rate limiting | Production-ready HTTP hardening |

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **S3 as the data plane** | No service-to-service coupling. Any component can be replaced independently. Components communicate by writing/reading files from a shared session folder. |
| **Two-pass Claude analysis** | Pass 1 extracts raw facts (what was shown, what was asked). Pass 2 generates contextual recommendations. Separating extraction from interpretation improves accuracy. |
| **Silent screenshots** | `captureVisibleTab()` fires on every click with no visible flash. Visitors don't notice. Periodic fallback captures non-click navigation. |
| **Session-triggered recording** | Audio starts/stops automatically based on S3 session lifecycle. No manual intervention by the SE during the demo. |
| **Self-contained HTML reports** | Inline CSS, base64 images, no CDN links. Reports work in email clients, offline, anywhere. |
| **Watcher polling (not events)** | S3 event notifications add infrastructure complexity. Polling every 30s is simple, reliable, and good enough for trade show cadence. |

---

## Project Stats

| Metric | Count |
|--------|-------|
| Commits | 232+ |
| Pull requests | 120+ |
| Source files (JS) | 70 |
| Source files (Python) | 24 |
| Source files (HTML) | 38 |
| Shell scripts | 22 |
| Test files | 43 |
| Days of development | 3 |

---

## Team

### Smells Like Machine Learning -- Hackathon 2026

```
  +------+  +------+  +------+  +------+  +------+
  |Casey |  | Joel |  | Tom  |  | Kush |  |Chris |
  |Mondoux| |Gins- |  |Gamull|  |Mangat|  |La-   |
  | MKT  |  |berg  |  |  SE  |  |  SE  |  |Fleur |
  |      |  |  TS  |  |      |  |      |  |  BD  |
  +------+  +------+  +------+  +------+  +------+
   App +     Chrome    App Dev   Present-  V1 Tenant
   Web UI    Ext +                ation +  Provision
   Present-  Audio +              Demo     + Present-
   ation     AWS +                Flow     ation
             AI
```

| Name | Role | Focus Areas |
|------|------|-------------|
| **Casey Mondoux** | MKT-NA | Android app, web interface, presentation |
| **Joel Ginsberg** | TS-NA | Chrome extension, audio capture, AWS infra, AI analysis |
| **Tom Gamull** | SE-NA | App development |
| **Kush Mangat** | SE-NA | Presentation, demo flow |
| **Chris LaFleur** | BD-NA | V1 tenant provisioning, presentation |

---

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full system architecture with diagrams |
| [DATA-CONTRACT.md](DATA-CONTRACT.md) | S3 session folder schema (the API between components) |
| [DEMO-WALKTHROUGH.md](docs/DEMO-WALKTHROUGH.md) | Step-by-step demo script for trade shows |
| [DEMO-QUICK-START.md](docs/DEMO-QUICK-START.md) | 5-minute setup guide |
| [PRESENTER-GUIDE.md](docs/PRESENTER-GUIDE.md) | Dashboard user guide |
| [CHANGELOG.md](CHANGELOG.md) | All changes organized by date |
| [PROJECT-PLAN.md](PROJECT-PLAN.md) | Architecture decisions + integration map |

---

<p align="center">
<i>Built for Black Hat, RSA, and re:Invent.</i><br>
<i>Every demo remembered. Every visitor followed up.</i><br>
<br>
<b>Trend Micro -- Hackathon 2026</b>
</p>
