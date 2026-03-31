# BoothApp -- AI-Powered Trade Show Demo Capture

```
 ____              _   _       _
| __ )  ___   ___ | |_| |__   / \   _ __  _ __
|  _ \ / _ \ / _ \| __| '_ \ / _ \ | '_ \| '_ \
| |_) | (_) | (_) | |_| | | / ___ \| |_) | |_) |
|____/ \___/ \___/ \__|_| |_/_/   \_\ .__/| .__/
                                     |_|   |_|
```

> **Record everything. Analyze instantly. Follow up personally.**

A visitor walks up to your trade show booth. The SE gives a live product demo.
Minutes later, the visitor receives a personalized summary of exactly what they
saw, what interested them, and what to explore next -- powered by Claude AI.

---

## Architecture

```
  CAPTURE                      STORAGE              PROCESSING
  =======                      =======              ==========

  +------------------+
  | Chrome Extension |--+                      +------------------+
  | clicks + screens |  |   +--------------+   | Watcher          |
  +------------------+  +-->|              |-->| polls S3 for     |
                        |   |  S3 Session  |   | completed        |
  +------------------+  +-->|    Store     |   | sessions         |
  | Audio Recorder   |  |   |              |   +---------+--------+
  | mic + transcript |--+   +--------------+             |
  +------------------+  |                                v
                        |                      +------------------+
  +------------------+  |                      | Analysis Engine  |
  | Badge Scanner    |--+                      | correlate clicks |
  | OCR + session ID |                         | + audio + screen |
  +------------------+                         +---------+--------+
                                                         |
                                                         v
                                               +------------------+
                                               | Claude AI        |
                                               | * interests      |
                                               | * engagement     |
                                               | * follow-up recs |
                                               +---------+--------+
                                                         |
                                                         v
                                               +------------------+
                                               | HTML Report      |
                                               | personalized     |
                                               | summary + recs   |
                                               +------------------+
```

**Pipeline:** Chrome ext + audio + badge --> S3 --> watcher --> analysis --> Claude --> report

---

## How It Works

```
 [1] BADGE SCAN       [2] LIVE DEMO        [3] UPLOAD         [4] AI ANALYSIS
 ==============       ===========          =========          ==============
 Scan badge     -->   Record audio   -->   Session data -->   Correlate clicks
 Extract name         Track clicks         uploads to S3      + transcript
 Start session        Take screenshots                        Claude two-pass
                                                              Render report
```

**Status flow:** `active` --> `ended` --> `analyzing` --> `complete`

---

## Quick Start

**Prerequisites:** Node.js 18+ | AWS CLI | Chrome | ffmpeg | Python 3.10+

```bash
# Clone and install
git clone https://github.com/altarr/boothapp.git && cd boothapp
npm install

# Chrome extension
#   chrome://extensions -> Developer Mode -> Load Unpacked -> extension/

# Analysis dependencies
cd analysis && npm install && pip install -r requirements.txt && cd ..

# Configure environment
cp .env.example .env        # Add your AWS + Claude API keys

# Run full pipeline with synthetic data (no hardware needed)
bash scripts/run-demo-simulation.sh
```

### Run Individual Services

```bash
node infra/session-orchestrator/orchestrator.js   # Session API on :3000
node analysis/watcher.js                          # S3 session poller
node audio/recorder.js                            # Mic capture
```

---

## Project Structure

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

### S3 Session Layout

```
sessions/<session-id>/
  metadata.json           visitor info, status, timestamps
  audio/recording.wav     mic capture
  transcript/*.json       timestamped speaker segments
  clicks/clicks.json      click events with DOM paths
  screenshots/*.jpg       periodic + click-triggered captures
  output/summary.html     final personalized report
  output/summary.json     structured analysis data
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Capture | Chrome Extension (Manifest V3), ffmpeg, Whisper |
| Storage | AWS S3, CloudFormation |
| Analysis | Node.js, Python, Claude API (two-pass) |
| Output | HTML reports, structured JSON |
| Orchestration | Session API (Express), S3 event polling |

---

## Scripts

| Script | Purpose |
|--------|---------|
| `run-demo-simulation.sh` | Full pipeline test with synthetic data |
| `health-check.sh` | Verify all services are running |
| `test-integration.sh` | End-to-end integration test suite |
| `validate-session.sh` | Validate session data completeness |

---

## Team

### Smells Like Machine Learning -- Hackathon 2026

| Name | Role |
|------|------|
| **Casey Mondoux** | App, web UI, presentation |
| **Joel Ginsberg** | Chrome extension, audio, AWS infra, AI analysis |
| **Tom Gamull** | App development |
| **Kush Mangat** | Presentation, demo flow |
| **Chris LaFleur** | V1 tenant provisioning, presentation |

---

*Every demo remembered. Every visitor followed up.*
