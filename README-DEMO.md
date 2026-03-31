```
 ____              _   _       _
| __ )  ___   ___ | |_| |__   / \   _ __  _ __
|  _ \ / _ \ / _ \| __| '_ \ / _ \ | '_ \| '_ \
| |_) | (_) | (_) | |_| | | / ___ \| |_) | |_) |
|____/ \___/ \___/ \__|_| |_/_/   \_\ .__/| .__/
                                     |_|   |_|
```

# BoothApp -- AI-Powered Trade Show Demo Capture

### *Record everything. Analyze instantly. Follow up personally.*

> **Team:** Smells Like Machine Learning | **Event:** AWS Hackathon 2026
> **Built in 3 days.** 284 commits. 120+ pull requests. 5 people.

---

## The Problem

Sales Engineers give 50+ live demos per day at trade shows. By hour three,
details blur together. Who asked about container security? Who was comparing
with CrowdStrike? What did they actually see? Follow-up emails become
generic -- "Great meeting you at Black Hat!" -- and deals go cold.

**Result:** $0 pipeline from a $500K booth investment.

## The Solution

BoothApp captures **everything** during a live booth demo -- the conversation
audio, every click and screenshot in the product console, and the visitor's
badge -- then uses **Claude AI** to generate a personalized follow-up
package within minutes of the visitor walking away.

The visitor receives:
- A summary of exactly what they saw and asked about
- Their specific interest areas and buying signals
- Recommended next steps tailored to their questions
- A link to their own preserved product tenant to keep exploring

**No demo forgotten. No visitor left behind.**

---

## Architecture

```
  VISITOR ARRIVES                                              VISITOR LEAVES
       |                                                            |
       v                                                            v
  +-----------+                                            +-----------------+
  |  Android  |   badge photo                              | Follow-Up Email |
  |  App      |-- OCR name --.                         .-->| * AI summary    |
  | (scanner) |              |                         |   | * product recs  |
  +-----------+              |                         |   | * tenant link   |
                             v                         |   +-----------------+
  +--------------------------------------------------------------+
  |                       DEMO PC                                |
  |                                                              |
  |  +------------------+         +--------------------+         |
  |  |  Chrome Extension |         |  Audio Recorder    |         |
  |  |  (Manifest V3)   |         |  (Node.js + ffmpeg)|         |
  |  |                  |         |                    |         |
  |  |  * click capture |         |  * USB mic auto-   |         |
  |  |  * silent screen-|         |    detect          |         |
  |  |    shots on every|         |  * WAV 44100Hz     |         |
  |  |    click         |         |  * session-         |         |
  |  |  * DOM path log  |         |    triggered       |         |
  |  |  * periodic      |         |  * graceful stop   |         |
  |  |    fallback      |         |                    |         |
  |  +--------+---------+         +---------+----------+         |
  |           |                             |                    |
  +-----------+-----------------------------+--------------------+
              |                             |
              +----------+------------------+
                         |
                         v
  +--------------------------------------------------------------+
  |                      AWS S3                                  |
  |  sessions/<session-id>/                                      |
  |  |-- metadata.json        (badge, visitor name, timestamps)  |
  |  |-- badge.jpg            (badge photo from phone)           |
  |  |-- clicks/clicks.json   (every click + DOM path + coords)  |
  |  |-- screenshots/*.jpg    (silent capture on each click)     |
  |  |-- audio/recording.wav  (full conversation audio)          |
  |  |-- transcript/*.json    (timestamped speaker segments)     |
  |  +-- output/                                                 |
  |      |-- summary.json     (structured AI analysis)           |
  |      |-- summary.html     (self-contained HTML report)       |
  |      |-- follow-up.json   (SDR action items + priority)      |
  |      +-- follow-up-email.html  (email-ready for visitor)     |
  +------------------------------+-------------------------------+
                                 |
              S3 event detected by Watcher (polls every 30s)
                                 |
                                 v
  +--------------------------------------------------------------+
  |                   ANALYSIS PIPELINE                          |
  |                                                              |
  |  +--------------+    +--------------+    +----------------+  |
  |  |  Correlator  |--->| Claude AI    |--->| Report Render  |  |
  |  |              |    | (two-pass)   |    |                |  |
  |  | merge clicks |    |              |    | * summary.html |  |
  |  | + audio by   |    | Pass 1:      |    | * summary.json |  |
  |  | timestamp    |    |  extract     |    | * follow-up    |  |
  |  |              |    |  facts       |    | * email HTML   |  |
  |  | + screenshot |    |              |    |                |  |
  |  |   matching   |    | Pass 2:      |    | + competitive  |  |
  |  |              |    |  generate    |    |   intel        |  |
  |  | + engagement |    |  recommend-  |    | + demo script  |  |
  |  |   scoring    |    |  ations      |    |   suggestions  |  |
  |  +--------------+    +--------------+    +----------------+  |
  |                                                              |
  +------------------------------+-------------------------------+
                                 |
                                 v
  +--------------------------------------------------------------+
  |                   PRESENTER DASHBOARD                        |
  |                                                              |
  |  Live session tracker  |  Session deep-dive  |  Analytics    |
  |  Screenshot gallery    |  Engagement heatmap  |  ROI calc    |
  |  Email generator       |  Demo script         |  Highlights  |
  |  Feedback forms        |  Visitor insights    |  Admin       |
  +--------------------------------------------------------------+
```

**Pipeline:** `badge + clicks + audio --> S3 --> watcher --> correlator --> Claude --> report --> dashboard`

**Status flow:** `active` --> `ended` --> `analyzing` --> `complete`

---

## How to Run a Demo

### Prerequisites

```
  [x] Google Chrome with V1-Helper extension loaded
  [x] Node.js 18+
  [x] Python 3.9+ with pip
  [x] ffmpeg (audio capture)
  [x] AWS CLI configured (hackathon profile)
  [x] Android phone with BoothApp scanner app
```

### Step 1: Preflight Check

```bash
bash scripts/preflight.sh     # Verify AWS, Chrome ext, audio, all green
```

All items must show `PASS`. Fix any failures before starting.

### Step 2: Start Services (4 terminals)

```bash
# Terminal 1 -- Audio recorder (waits for session trigger)
cd audio && node recorder.js

# Terminal 2 -- S3 watcher (polls for completed sessions)
cd analysis && node watcher.js

# Terminal 3 -- Presenter dashboard
cd presenter && node server.js         # http://localhost:3001

# Terminal 4 -- Session orchestrator
cd infra/session-orchestrator && node orchestrator.js   # http://localhost:3000
```

### Step 3: Badge Scan (Phone)

1. Open BoothApp on Android phone
2. Point camera at visitor's badge
3. OCR extracts name, company
4. Session ID created -> written to S3
5. Chrome extension + audio recorder detect new session and start automatically

### Step 4: Give the Demo

Talk naturally. BoothApp captures everything silently:
- **Every click** logged with DOM path, coordinates, element metadata
- **Silent screenshot** on every click (no flash, no delay)
- **Periodic screenshot** fallback every N seconds
- **Full audio** from USB mic on demo PC
- Chrome extension popup shows live click count + screenshot count

### Step 5: End Session (Phone)

Tap **"End Session"** on the Android app. What happens next:

```
  End Session tap
       |
       v
  S3 metadata.json updated: status -> "ended"
       |
       +--> Chrome extension detects end, uploads remaining data
       +--> Audio recorder stops (graceful SIGINT, WAV valid)
       |
       v
  Watcher detects completed session (all files present)
       |
       v
  Pipeline starts:
       |
       +--> Correlator merges clicks + transcript by timestamp
       +--> Claude Pass 1: extract facts (what shown, questions asked)
       +--> Claude Pass 2: generate recommendations + follow-up
       +--> Render HTML report + structured JSON
       |
       v
  Results written to S3: output/summary.html, summary.json,
                         follow-up.json, follow-up-email.html
       |
       v
  Dashboard updates automatically
```

### Step 6: View Results

Open the presenter dashboard at `http://localhost:3001`:
- Click any session to see the full AI-generated report
- Screenshot gallery shows exactly what the visitor saw
- Timeline view shows the conversation minute-by-minute

### No Hardware? Run the Simulation

```bash
bash scripts/run-demo-simulation.sh
```

Generates synthetic session data and runs the full pipeline end-to-end.

---

## What the Output Looks Like

### AI-Generated Session Summary (summary.json)

```json
{
  "attendee": "Alex Chen",
  "company": "Acme Corp",
  "engagement_score": 9,
  "duration_min": 12.4,
  "executive_summary": "Deep interest in cloud workload protection.
    Asked detailed questions about container runtime security and
    Kubernetes policy enforcement. Currently using a competitor
    product but evaluating alternatives for multi-cloud deployment.",
  "key_moments": [
    {
      "timestamp": "2:40",
      "type": "high_interest",
      "description": "Asked about K8s admission control -- leaned in,
        took photo of screen"
    },
    {
      "timestamp": "5:30",
      "type": "competitive_mention",
      "description": "Mentioned CrowdStrike Falcon lacks multi-cloud
        visibility"
    }
  ],
  "key_topics": [
    "Container security",
    "Kubernetes admission control",
    "Multi-cloud visibility",
    "Runtime threat detection"
  ],
  "products_discussed": [
    "Cloud Security",
    "Endpoint Protection"
  ],
  "competitive_intel": {
    "current_vendor": "CrowdStrike",
    "pain_points": ["No multi-cloud support", "Complex K8s policies"],
    "switching_signals": "HIGH"
  },
  "follow_up": {
    "priority": "HIGH",
    "action": "Schedule technical deep-dive on container security",
    "contacts": ["SE team", "Cloud security PM"],
    "timeline": "Within 1 week"
  },
  "sentiment": "Very positive -- actively comparing solutions",
  "session_score": 87
}
```

### Conversation Timeline (from Correlator)

```
[00:00]  Rep opens Cloud Security console, shows dashboard overview
         -> click: #menuserver_cloud_app > .dashboard-overview
         -> screenshot: click-001.jpg

[01:15]  Attendee: "How does this handle Kubernetes namespaces?"
         -> Rep navigates to workload protection

[02:40]  Rep demonstrates runtime protection policy creation
         -> 3 clicks captured, attendee engagement HIGH
         -> screenshot: click-004.jpg (attendee took phone photo)

[04:10]  Attendee: "We're using CrowdStrike but the multi-cloud
          story is weak"
         -> COMPETITIVE MENTION flagged

[05:30]  Rep shows multi-cloud visibility across AWS + Azure
         -> click: #cloud-accounts > .multi-cloud-view

[07:00]  Attendee: "What does pricing look like for 500 endpoints?"
         -> BUYING SIGNAL flagged

[09:45]  Rep walks through container image scanning workflow
         -> 5 clicks captured, deep technical discussion

[11:20]  Attendee: "Can we get a follow-up with your SE team?"
         -> MEETING REQUEST flagged

[12:24]  Session ends -- engagement score: 9/10
```

### HTML Report (summary.html)

Self-contained HTML with inline CSS -- works in email clients, offline, anywhere:

- **Header:** Attendee name, company, timestamp, engagement badge
- **Executive Summary:** AI-generated narrative of the conversation
- **Key Moments:** Timestamped highlights with engagement markers
- **Screenshot Gallery:** What the visitor actually saw, in order
- **Product Fit:** Scored recommendations with confidence levels
- **Competitive Intel:** Current vendor, pain points, switching signals
- **Follow-Up Actions:** Priority, recommended contacts, timeline
- **Conversation Timeline:** Full minute-by-minute breakdown

### Follow-Up Email (follow-up-email.html)

```
Subject: Your Vision One Demo -- Container Security Deep Dive

Hi Alex,

Thanks for stopping by our booth today. Based on our conversation
about container runtime security and Kubernetes policy enforcement,
I wanted to share some resources:

[AI-tailored content based on exactly what they asked about]

Your personal Vision One tenant is ready to explore:
https://v1-tenant-abc123.trendmicro.com

It will remain active for 30 days. Everything we showed today is
pre-configured.

Best,
[SE Name]
```

---

## Component Breakdown

| Component | Language | Files | Role |
|-----------|----------|-------|------|
| **Chrome Extension** | JavaScript (Manifest V3) | 8 | Silent click + screenshot capture inside any web app |
| **Audio Recorder** | Node.js + ffmpeg | 6 | USB mic auto-detect, session-triggered WAV capture |
| **Watcher** | Node.js | 3 | S3 poller -- detects completed sessions, triggers pipeline |
| **Correlator** | Node.js | 4 | Merges clicks + transcript + screenshots by timestamp |
| **Claude Analysis** | Python + Bedrock | 12 | Two-pass AI: fact extraction then recommendations |
| **Report Renderer** | Node.js + HTML | 8 | Self-contained HTML reports, email-ready output |
| **Presenter Dashboard** | Express + vanilla JS | 20+ | Live session tracker, gallery, analytics, email gen |
| **Android Scanner** | Kotlin | 6 | Badge photo -> OCR -> session creation |
| **Session Orchestrator** | Node.js + Express | 4 | Session lifecycle API, S3 coordination |
| **Scripts** | Bash | 15+ | Preflight, health check, demo simulation, deployment |

---

## Tech Stack

```
  +-----------------------------------------------------------+
  |                     CAPTURE LAYER                         |
  |  Chrome Extension    : JavaScript, Manifest V3            |
  |  Audio Recorder      : Node.js, ffmpeg, WebSocket         |
  |  Badge Scanner       : Android (Kotlin), ML Kit OCR       |
  +-----------------------------------------------------------+
  |                     STORAGE LAYER                         |
  |  Amazon S3           : Session data, reports, dashboard   |
  |  CloudFormation      : Infrastructure as code             |
  +-----------------------------------------------------------+
  |                     ANALYSIS LAYER                        |
  |  Correlator          : Node.js (click + audio merger)     |
  |  Claude AI           : Amazon Bedrock (two-pass analysis) |
  |  Product Detector    : Python (product mention scoring)   |
  |  Competitive Engine  : Python (vendor intel extraction)   |
  |  Report Renderer     : Node.js + HTML/CSS (inline)        |
  |  Email Generator     : Node.js (email-ready HTML)         |
  +-----------------------------------------------------------+
  |                     PRESENTATION LAYER                    |
  |  Presenter Dashboard : Express.js + vanilla JS            |
  |  20+ pages           : Gallery, heatmap, analytics,       |
  |                        ROI calculator, email generator,   |
  |                        session replay, visitor insights   |
  +-----------------------------------------------------------+
  |                     OPERATIONS                            |
  |  Testing             : pytest + Jest (80 test files)      |
  |  CI/CD               : GitHub Actions                     |
  |  Scripts             : Bash (preflight, health, deploy)   |
  |  IaC                 : AWS CloudFormation                 |
  +-----------------------------------------------------------+
```

---

## Key Design Decisions

| Decision | Why |
|----------|-----|
| **S3 as the data plane** | No service-to-service coupling. Components communicate by reading/writing files to a shared session folder. Any component can be replaced independently. |
| **Two-pass Claude analysis** | Pass 1 extracts raw facts (what was shown, what was asked). Pass 2 generates contextual recommendations. Separating extraction from interpretation improves accuracy and reduces hallucination. |
| **Silent screenshots** | `captureVisibleTab()` fires on every click with no visible flash. Visitors don't notice. Periodic fallback captures non-click navigation. |
| **Session-triggered recording** | Audio + extension start/stop automatically based on S3 session lifecycle. Zero manual intervention by the SE during the demo. |
| **Self-contained HTML reports** | Inline CSS, no CDN links. Reports work in email clients, offline, disconnected. One file = one report. |
| **Watcher polling over S3 events** | S3 event notifications add infrastructure complexity. Polling every 30s is simple, reliable, and matches trade show cadence. |

---

## Project Stats

```
  +----------------------------------+
  |  Commits          :  284         |
  |  Pull Requests    :  120+        |
  |  Source (JS)      :   85 files   |
  |  Source (Python)  :   27 files   |
  |  Source (HTML)    :   46 files   |
  |  Shell Scripts    :   34 files   |
  |  Test Files       :   80 files   |
  |  Days Built       :    3         |
  |  Team Size        :    5         |
  +----------------------------------+
```

---

## Quick Test

```bash
# Run the full test suite
npm test

# Run Python analysis tests
cd analysis && pip install -r requirements.txt && python -m pytest tests/ -v

# Run integration verification (38 checks across all components)
bash scripts/test-integration.sh

# Verify all services are healthy
bash scripts/health-check.sh

# Run a full pipeline with synthetic data
bash scripts/run-demo-simulation.sh
```

---

## The Team -- "Smells Like Machine Learning"

```
  +--------+  +--------+  +--------+  +--------+  +--------+
  | Casey  |  |  Joel  |  |  Tom   |  |  Kush  |  | Chris  |
  |Mondoux |  | Gins-  |  | Gamull |  | Mangat |  |  La-   |
  |        |  | berg   |  |        |  |        |  | Fleur  |
  | MKT-NA |  | TS-NA  |  | SE-NA  |  | SE-NA  |  | BD-NA  |
  +--------+  +--------+  +--------+  +--------+  +--------+
    App +       Chrome     App Dev    Present-    V1 Tenant
    Web UI      Ext +                  ation +    Provision
    Present-    Audio +                Demo       + Present-
    ation       AWS +                  Flow       ation
                AI
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [README.md](README.md) | Full technical documentation |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture with diagrams |
| [DATA-CONTRACT.md](DATA-CONTRACT.md) | S3 session folder schema (the API between components) |
| [DEMO-WALKTHROUGH.md](docs/DEMO-WALKTHROUGH.md) | Step-by-step demo script for presenters |
| [DEMO-QUICK-START.md](docs/DEMO-QUICK-START.md) | 5-minute setup guide |
| [PRESENTER-GUIDE.md](docs/PRESENTER-GUIDE.md) | Dashboard user guide |
| [CHANGELOG.md](CHANGELOG.md) | All changes organized by date |
| [PROJECT-PLAN.md](PROJECT-PLAN.md) | Architecture decisions + integration map |

---

*Built for Black Hat, RSA, and re:Invent.*
*Every demo remembered. Every visitor followed up.*

**Hackathon 2026**
