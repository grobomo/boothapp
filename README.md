# BoothApp

### AI-Powered Trade Show Demo Capture

> Record everything. Analyze instantly. Follow up personally.

BoothApp captures live trade show demos -- clicks, screenshots, audio -- and uses
Claude to generate personalized follow-up summaries for every booth visitor.
Built for Black Hat, Reinvent, and any conference with live product demos.

---

## How It Works

A visitor walks up to the booth. The SE scans their badge, gives a live product
demo, and walks away. Minutes later, the visitor receives a personalized summary
of exactly what they saw, what they asked about, and what to explore next -- with
a link to their own product tenant.

## Architecture

```
  CAPTURE                      PROCESS                     OUTPUT
  =======                      =======                     ======

  Chrome Extension              S3 Session Store
  +-------------------+         +------------------+
  | click tracking    |-------->| clicks.json      |
  | page screenshots  |-------->| screenshots/     |
  +-------------------+         |                  |
                                |                  |        Watcher
  Audio Recorder                |                  |        +------------------+
  +-------------------+         |                  |------->| polls S3 for     |
  | USB mic capture   |-------->| recording.wav    |        | completed        |
  | speaker detection |         | transcript.json  |        | sessions         |
  +-------------------+         |                  |        +--------+---------+
                                |                  |                 |
  Badge Scanner                 |                  |                 v
  +-------------------+         |                  |        Analysis Pipeline
  | photo -> OCR      |-------->| metadata.json    |        +------------------+
  | extract name      |         +------------------+        | correlate clicks |
  | create session ID |                                     | + transcript     |
  +-------------------+                                     | into timeline    |
                                                            +--------+---------+
                                                                     |
                                                                     v
                                                            Claude AI (two-pass)
                                                            +------------------+
                                                            | extract interests|
                                                            | score engagement |
                                                            | gen follow-up    |
                                                            +--------+---------+
                                                                     |
                                                                     v
                                                            HTML Report
                                                            +------------------+
                                                            | demo summary     |
                                                            | interest signals |
                                                            | SDR action items |
                                                            | V1 tenant link   |
                                                            +------------------+
```

**Data flow:** Chrome extension + audio recorder + badge scanner all write to S3.
The watcher detects completed sessions and triggers the analysis pipeline.
Claude correlates clicks with the transcript, extracts visitor interests, and
renders a self-contained HTML report with follow-up recommendations.

## Quick Start

**Prerequisites:** Node.js 18+ | AWS CLI | Chrome | ffmpeg | Python 3.10+

```bash
# Clone and install
git clone https://github.com/altarr/boothapp.git && cd boothapp
npm install

# Load the Chrome extension
#   chrome://extensions -> Developer Mode -> Load Unpacked -> select extension/

# Install analysis deps
cd analysis && npm install && pip install -r requirements.txt && cd ..

# Configure (copy .env.example and edit)
cp .env.example .env

# Launch (three terminals)
node infra/session-orchestrator/orchestrator.js    # Session API on :3000
node analysis/watcher.js                           # Polls S3 for sessions
node audio/recorder.js                             # Mic capture

# Or run everything with synthetic data -- no hardware needed
bash scripts/run-demo-simulation.sh
```

## Components

```
boothapp/
  extension/     Chrome extension -- click tracking + screenshots (Manifest V3)
  audio/         Audio capture -- USB mic recording + transcription
  analysis/      AI pipeline -- correlator, Claude analyzer, report renderer
  infra/         Session orchestrator + S3 CloudFormation
  presenter/     Presenter dashboard -- session timeline + review UI
  demo/          Demo landing page + session review interface
  scripts/       Simulation, health check, integration tests
  docs/          Architecture docs + demo walkthrough
```

| Component | What It Does |
|-----------|-------------|
| **Chrome Extension** | Intercepts clicks, captures screenshots, tracks DOM paths |
| **Audio Recorder** | Records USB mic via ffmpeg, uploads WAV to S3 |
| **Correlator** | Merges click events + transcript into time-aligned timeline |
| **Claude Analyzer** | Two-pass AI: extract interests, score engagement, gen recs |
| **Report Renderer** | Self-contained HTML summary with screenshots + follow-up |
| **Session Orchestrator** | REST API for session lifecycle and demo PC commands |
| **Watcher** | Polls S3 for completed sessions, triggers analysis pipeline |

## Session Lifecycle

```
  badge scan        demo running        session ends       AI analysis
  ==========        ============        ============       ===========

  [1] OCR       --> [2] Audio +      --> [3] Upload   --> [4] Correlate
      badge          clicks +             all to S3        timeline
      -> name        screenshots                      --> [5] Claude
      -> session ID                                        two-pass
                                                      --> [6] Render
                                                           HTML report
```

**Status:** `active` -> `ended` -> `analyzing` -> `complete`

## S3 Session Layout

```
sessions/<session-id>/
  metadata.json            visitor info, status, timestamps
  audio/recording.wav      mic capture
  transcript/*.json        timestamped speaker segments
  clicks/clicks.json       click events with DOM paths
  screenshots/*.jpg        click-triggered + periodic captures
  output/summary.html      self-contained HTML report
  output/summary.json      structured analysis results
```

## Scripts

| Script | Purpose |
|--------|---------|
| `run-demo-simulation.sh` | End-to-end pipeline test with synthetic data |
| `health-check.sh` | Verify all services are running |
| `test-integration.sh` | Integration test suite |
| `validate-session.sh` | Validate session S3 data completeness |

## Team

**Smells Like Machine Learning** -- Hackathon 2026

| Name | Role | Focus |
|------|------|-------|
| Casey Mondoux | MKT-NA | App, web UI, presentation |
| Joel Ginsberg | TS-NA | Chrome ext, audio, AWS infra, AI analysis |
| Tom Gamull | SE-NA | App development |
| Kush Mangat | SE-NA | Presentation, demo flow |
| Chris LaFleur | BD-NA | V1 tenant provisioning, presentation |

---

*Built for trade show booths everywhere. Every demo remembered. Every visitor followed up.*
