```
 ____              _   _        _
| __ )  ___   ___ | |_| |__    / \   _ __  _ __
|  _ \ / _ \ / _ \| __| '_ \  / _ \ | '_ \| '_ \
| |_) | (_) | (_) | |_| | | |/ ___ \| |_) | |_) |
|____/ \___/ \___/ \__|_| |_/_/   \_\ .__/| .__/
                                     |_|   |_|
```

**AI-Powered Trade Show Demo Capture**

*Turn every booth conversation into actionable intelligence.*

---

## The Problem

Sales reps run **dozens of booth demos per day** at trade shows. After the event,
they remember almost nothing -- who was interested in what, which features resonated,
what follow-up was promised. Leads go cold. Revenue stays on the table.

## The Solution

BoothApp captures the **full context** of every demo -- screen activity, audio, and
visitor badge -- then uses AI to generate structured reports with engagement scores,
topic detection, and personalized follow-up emails. All automated. All in real time.

---

## Architecture

```
    +========================+
    |      CAPTURE LAYER     |
    +========================+
    |                        |
    |  +------------------+  |    +------------------+
    |  | Chrome Extension |  |    | Badge Scanner    |
    |  | (Manifest V3)    |  |    | (photo capture)  |
    |  |                  |  |    +--------+---------+
    |  | * Screen capture |  |             |
    |  | * Audio record   |  |             |
    |  | * Click tracking |  |             |
    |  +--------+---------+  |             |
    |           |            |             |
    +=========__|============+             |
                |                          |
                v                          v
    +========================+   +---------+--------+
    |    TRANSPORT LAYER     |   |  Session Manager  |
    +========================+   |  (correlate badge  |
    |                        |   |   to recording)    |
    |  Lambda (API Gateway)  |   +--------+---------+
    |  generates pre-signed  |            |
    |  S3 upload URLs        |            |
    |                        |            |
    +==========+=============+            |
               |                          |
               v                          v
    +=============================================+
    |              AWS S3 BUCKET                   |
    |  s3://boothapp-sessions-<account>/           |
    |                                              |
    |  sessions/<id>/                              |
    |    audio.webm          raw audio recording   |
    |    clicks.json         timestamped events    |
    |    screenshots/        captured frames       |
    |    badge.json          visitor metadata       |
    |    ready               trigger file           |
    +======================+=======================+
                           |
                           | (poll every 5s)
                           v
    +=============================================+
    |           ANALYSIS PIPELINE                  |
    +=============================================+
    |                                              |
    |  +------------+  +-----------+  +----------+ |
    |  | Transcribe |  | Correlate |  | Bedrock  | |
    |  | (Whisper)  |  | clicks +  |  | (Claude) | |
    |  | audio ->   |  | screens + |  | AI       | |
    |  | text       |  | transcript|  | analysis | |
    |  +------+-----+  +-----+-----+  +----+-----+ |
    |         |              |              |       |
    |         +--------------+--------------+       |
    |                        |                      |
    |                        v                      |
    |               +----------------+              |
    |               | HTML Report    |              |
    |               | + Follow-up    |              |
    |               |   Email        |              |
    |               +----------------+              |
    +=============================================+
```

---

## Key Features

- **Real-time screen + audio capture** via Chrome Extension (Manifest V3)
- **Pre-signed S3 uploads** -- no credentials on the client, Lambda handles auth
- **2-second correlation window** -- clicks, transcript segments, and screenshots
  are merged into a unified timeline
- **Product topic detection** -- regex-based identification of XDR, Endpoint Security,
  ZTSA, Cloud Security, and Email Security mentions
- **Engagement scoring** -- quantified visitor interest per topic
- **AI-powered analysis** -- Amazon Bedrock (Claude) generates insights and next steps
- **Personalized follow-up emails** -- auto-generated templates with topic-specific
  content, CTAs, and resource links
- **Health dashboard** -- HTML monitoring page for pipeline status
- **Demo-day preflight** -- 9-point automated system check before showtime
- **Structured error handling** -- transient vs. permanent failure classification
  with exponential backoff retry

---

## S3 Data Contract

Each session is stored under a unique session ID:

```
s3://boothapp-sessions-<account>/sessions/<session-id>/
  |
  |-- audio.webm              # WebM audio recording (MediaRecorder API)
  |-- clicks.json             # Array of click events:
  |                           #   [{ timestamp: <ms>, url: <string>,
  |                           #      element: <string>, x: <n>, y: <n> }]
  |-- screenshots/
  |   |-- click-001.jpg       # Frame captures matched to click events
  |   |-- click-002.jpg       #   (filename = click-<NNN>.jpg)
  |   +-- ...
  |-- badge.json              # Visitor badge data:
  |                           #   { name, company, title, email }
  |-- ready                   # Empty trigger file -- signals session complete
  |
  +-- output/                 # Written by analysis pipeline:
      |-- result.json         # Full analysis output
      |-- report.html         # Human-readable HTML report
      |-- follow-up-email.html# Personalized follow-up template
      +-- error.json          # On failure: { type, stage, message, retryable }
```

**Contract rules:**
- `ready` file must be the **last** file written -- the watcher uses it as a trigger
- `clicks.json` timestamps are epoch milliseconds, matching `audio.webm` timeline
- Screenshots are JPEG, named `click-NNN.jpg`, correlated by 2-second window
- `output/` directory is created by the pipeline -- never pre-create it
- `error.json` and `result.json` are mutually exclusive -- presence of either
  marks the session as processed

---

## Setup

### Prerequisites

- Node.js 20.x
- AWS CLI configured (`aws configure --profile hackathon`)
- Chrome browser (for the extension)
- AWS SAM CLI (for Lambda deployment)

### 1. Clone and Install

```bash
git clone https://github.com/grobomo/boothapp.git
cd boothapp
npm install
```

### 2. Chrome Extension

```bash
# Load as unpacked extension in Chrome:
#   1. Navigate to chrome://extensions
#   2. Enable "Developer mode"
#   3. Click "Load unpacked"
#   4. Select the extension/ directory

# The extension captures:
#   - Screen activity via chrome.tabCapture
#   - Audio via MediaRecorder API
#   - Click events via content script injection
```

### 3. Pre-signed URL Lambda

```bash
cd infra/presign-lambda
sam build
sam deploy --guided --profile hackathon
# Note the API Gateway endpoint URL from the output
```

### 4. Analysis Pipeline (Watcher)

```bash
# Set environment variables
export AWS_PROFILE=hackathon
export AWS_REGION=us-east-1
export BOOTH_S3_BUCKET=boothapp-sessions-752266476357

# Run the preflight check first
bash scripts/preflight.sh

# Start the watcher
npm run watcher
```

The watcher polls S3 every 5 seconds for sessions with a `ready` trigger file,
runs the three-stage pipeline (transcribe -> correlate -> analyze), and writes
the HTML report + follow-up email to the session's output directory.

---

## Running Tests

```bash
npm test
```

103 tests across three suites:

| Suite | Count | Covers |
|-------|-------|--------|
| `errors.test.js` | 32 | Error classification, retry logic, backoff |
| `correlator.test.js` | 31 | Timeline merge, topic detection, scoring |
| `email-template.test.js` | 40 | Follow-up email generation, personalization |

---

## Project Structure

```
boothapp/
|-- analysis/
|   |-- watcher.js              # S3 poller + pipeline orchestrator
|   |-- lib/
|   |   |-- pipeline.js         # 3-stage analysis pipeline with retry
|   |   |-- correlator.js       # Click/transcript/screenshot merger
|   |   |-- email-template.js   # Follow-up email generator
|   |   |-- errors.js           # Error classification + retry logic
|   |   +-- error-writer.js     # Structured error JSON output
|   +-- test/
|       |-- correlator.test.js  # 31 tests
|       |-- errors.test.js      # 32 tests
|       +-- email-template.test.js # 40 tests
|-- infra/
|   |-- presign-lambda/
|   |   |-- index.js            # Lambda handler (pre-signed S3 URLs)
|   |   +-- template.yaml       # SAM/CloudFormation template
|   +-- health.html             # Pipeline health dashboard
|-- scripts/
|   +-- preflight.sh            # 9-point demo-day system check
+-- package.json
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Capture | Chrome Extension (MV3) | Screen, audio, click recording |
| Upload | AWS Lambda + API Gateway | Pre-signed S3 URL generation |
| Storage | Amazon S3 | Session data persistence |
| Transcription | Amazon Transcribe / Whisper | Audio to text |
| Correlation | Node.js (correlator.js) | Timeline merge + topic detection |
| Analysis | Amazon Bedrock (Claude) | AI insights + recommendations |
| Email | Node.js (email-template.js) | Personalized follow-up generation |
| Infra | AWS SAM + CloudFormation | Infrastructure as code |
| Testing | Node.js built-in test runner | Zero-dependency test suite |

---

## Team: Smells Like Machine Learning

```
  +-----------------------------------------------+
  |         SMELLS LIKE MACHINE LEARNING           |
  |             Hackathon 2026                     |
  +-----------------------------------------------+
  |                                                |
  |   Casey Mondoux ............ Team Lead         |
  |   Joel Ginsberg ............ Backend + Infra   |
  |   Tom Gamull ............... Analysis Pipeline  |
  |   Kush Mangat .............. Chrome Extension   |
  |   Chris LaFleur ............ Frontend + Reports |
  |                                                |
  +-----------------------------------------------+
```

---

*Built with caffeine and Claude at Hackathon 2026.*
