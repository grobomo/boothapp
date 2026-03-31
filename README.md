# BoothApp

**AI-powered trade show demo capture and analysis platform.**

BoothApp records every interaction during a live product demo at a trade show
booth -- clicks, screenshots, and audio -- then runs an AI analysis pipeline
to produce a visitor engagement report with personalized follow-up emails.
Sales reps walk away from each demo with actionable intelligence instead of a
stack of business cards.

```
Built for Trend Micro Hackathon 2026
Team: Smells Like Machine Learning
```

---

## Architecture

```
  +---------------------+        +-------------------+
  |  Chrome Extension    |        |  Audio Recorder   |
  |  (V1-Helper)         |        |  (WebM via browser|
  |                      |        |   MediaRecorder)  |
  |  - click capture     |        |                   |
  |  - DOM path logging  |        +--------+----------+
  |  - auto screenshots  |                 |
  |  - session lifecycle |                 |
  +----------+-----------+                 |
             |                             |
             |  presigned PUT              |  presigned PUT
             v                             v
  +------------------------------------------------+
  |              Amazon S3 Bucket                   |
  |  sessions/{id}/metadata.json                    |
  |  sessions/{id}/clicks.json                      |
  |  sessions/{id}/screenshot.png                   |
  |  sessions/{id}/audio.webm                       |
  +------------------------+-----------------------+
                           |
                           |  S3 event / poll
                           v
  +------------------------------------------------+
  |           Session Watcher (Node.js)             |
  |                                                 |
  |  - polls for new sessions (ready trigger file)  |
  |  - retries with exponential backoff             |
  |  - health endpoint on :8080/health              |
  +------------------------+-----------------------+
                           |
                           v
  +------------------------------------------------+
  |           Analysis Pipeline                     |
  |                                                 |
  |  1. Download recording from S3                  |
  |  2. Transcribe audio (Amazon Bedrock)           |
  |  3. Analyze transcript (Claude on Bedrock)      |
  |  4. Correlate clicks + transcript + screenshots |
  |  5. Score engagement per 30s segment            |
  |  6. Detect product interest topics              |
  |  7. Generate follow-up email template           |
  +------------------------+-----------------------+
                           |
                           v
  +------------------------------------------------+
  |           Presenter Dashboard (Express)         |
  |                                                 |
  |  - session list with status + analysis links    |
  |  - demo landing page for live presentations     |
  |  - summary HTML viewer proxied from S3          |
  +------------------------------------------------+
```

---

## Components

### Chrome Extension (`extension/`)

Manifest V3 Chrome extension ("V1-Helper") that captures booth visitor
interactions in real time:

- **Click capture** with DOM path, CSS selector, coordinates, and page context
- **Automatic screenshots** on every click via `chrome.tabs.captureVisibleTab`
- **Session lifecycle** -- start/end via popup buttons, with a dismissible
  tracking banner overlaid on the page
- **S3 upload** of click buffer, screenshots, and metadata using presigned URLs
- **Trend Micro branded popup** with live counters, session indicator, and
  S3 configuration panel

### Session Watcher (`analysis/watcher.js`)

Long-running Node.js process that monitors a sessions directory for new
recordings:

- Polls every 5 seconds (configurable via `POLL_INTERVAL_MS`)
- Triggers the analysis pipeline when a `ready` file appears
- Retries transient failures with exponential backoff
- Classifies errors (S3 access denied, throttling, missing file, Bedrock
  validation) and writes structured `error.json` for dashboard display
- Exposes a `/health` endpoint with uptime, pending session count, and poll
  interval

### Analysis Pipeline (`analysis/lib/`)

Multi-stage AI pipeline orchestrated by `pipeline.js`:

| Stage | What it does |
|-------|-------------|
| **Download** | Fetches `audio.webm` from S3 |
| **Transcribe** | Sends audio to Amazon Bedrock for speech-to-text |
| **Analyze** | Sends transcript to Claude (Bedrock) for key insights |
| **Correlate** | Merges clicks, transcript segments, and screenshots into a time-aligned enriched timeline (`correlator.js`) |
| **Score** | Assigns engagement score (high/medium/low) per 30-second segment |
| **Detect topics** | Matches product interest areas: XDR, Endpoint Security, ZTSA, Cloud Security, Email Security |
| **Email template** | Generates a personalized follow-up email with topic-specific CTAs and resource links (`email-template.js`) |

### Presenter Dashboard (`presenter/`)

Express server that provides a live view of all booth sessions:

- `GET /api/sessions` -- lists all sessions with visitor name, status,
  creation time, and analysis availability
- `GET /api/sessions/:id/summary` -- proxies the rendered summary HTML from S3
- Static demo landing page for trade show presentations
- Session list page with status indicators

### Infrastructure (`infra/`)

- **Presign Lambda** (`presign-lambda/`) -- API Gateway-backed Lambda that
  generates presigned S3 PUT URLs for the Chrome extension. Supports
  `clicks`, `screenshot`, `metadata`, and `audio` file types with appropriate
  content types.
- **SAM template** (`template.yaml`) -- CloudFormation deployment for the
  Lambda + API Gateway stack
- **Health page** (`health.html`) -- static health check page

### Preflight Script (`scripts/preflight.sh`)

Automated pre-demo checklist that verifies all 9 dependencies before show
time: AWS CLI, S3 bucket access (put/get/delete round-trip), Lambda function,
Chrome extension manifest, FFmpeg, Python dependencies (boto3, anthropic),
Node.js, Git config, and watcher module.

```bash
bash scripts/preflight.sh
```

---

## Setup

### Prerequisites

- Node.js >= 18
- Python 3.10+ with `boto3` and `anthropic`
- AWS CLI configured with a profile that has S3 + Bedrock + Lambda access
- FFmpeg (for audio processing)
- Chrome browser (for the extension)

### 1. Install Dependencies

```bash
npm install
pip install boto3 anthropic
```

### 2. Load the Chrome Extension

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `extension/` directory
4. Click the V1-Helper icon, open Settings (gear), and configure your S3
   bucket and AWS credentials

See `extension/EXTENSION-GUIDE.md` for detailed usage instructions.

### 3. Deploy Infrastructure

```bash
cd infra/presign-lambda
sam build
sam deploy --guided
```

This creates the presigned URL API that the Chrome extension calls to upload
session data.

### 4. Start the Session Watcher

```bash
export S3_BUCKET=boothapp-recordings
export BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
export AWS_REGION=us-east-1

npm run watcher
```

The watcher will poll for new sessions and run the analysis pipeline
automatically.

### 5. Start the Presenter Dashboard

```bash
cd presenter
npm install
export S3_BUCKET=boothapp-sessions
node server.js
```

Open `http://localhost:3000` to view the demo landing page and session list.

### 6. Run Preflight Check

```bash
bash scripts/preflight.sh
```

All 9 checks should pass before demo day.

---

## S3 Data Contract

All session data lives under a single S3 bucket with this key structure:

```
sessions/{session_id}/
    metadata.json       # visitor name, status, timestamps
    clicks.json         # click event buffer from Chrome extension
    screenshot.png      # page screenshot at session start
    audio.webm          # full audio recording of the demo
    output/
        result.json     # analysis pipeline output
        error.json      # structured error (if pipeline failed)
    summary.html        # rendered engagement report
```

### metadata.json

```json
{
  "session_id": "demo-2026-03-31-001",
  "visitor_name": "Jane Smith",
  "status": "complete",
  "created_at": "2026-03-31T10:15:00Z"
}
```

### clicks.json

```json
{
  "session_id": "demo-2026-03-31-001",
  "events": [
    {
      "index": 1,
      "timestamp": "2026-03-31T10:15:12Z",
      "type": "click",
      "dom_path": "div.app-content > nav > a.endpoint-security",
      "element": {
        "tag": "a",
        "id": "",
        "class": "endpoint-security",
        "text": "Endpoint Security",
        "href": "/app/epp/endpoint-protection"
      },
      "coordinates": { "x": 245, "y": 380 },
      "page_url": "https://portal.trendmicro.com/...",
      "page_title": "Vision One",
      "screenshot_file": "click-001.png"
    }
  ]
}
```

### Presign Lambda Request

```
POST /presign
{
  "session_id": "demo-2026-03-31-001",
  "file_type": "clicks"          // clicks | screenshot | metadata | audio
}

Response:
{
  "upload_url": "https://s3.amazonaws.com/...",
  "expires_in": 3600
}
```

---

## Key Features

- **Zero-friction capture** -- booth staff press "Start Demo" and everything
  records automatically; no manual note-taking
- **AI-powered analysis** -- Claude on Bedrock analyzes the conversation and
  identifies product interest areas
- **Engagement scoring** -- 30-second segments scored by click activity and
  dialogue, giving reps a heat map of what resonated
- **Topic detection** -- automatic classification across 5 product areas
  (XDR, Endpoint, ZTSA, Cloud, Email) based on click URLs and transcript
  content
- **Personalized follow-ups** -- auto-generated email templates with
  topic-specific subject lines, product blurbs, and CTAs
- **Correlation engine** -- clicks, transcript, and screenshots merged into
  a unified timeline with screenshot-to-click matching (2-second window)
- **Resilient pipeline** -- exponential backoff retry, structured error
  classification, and S3 error upload so failures are visible in the dashboard
- **Preflight verification** -- one-command check of all 9 dependencies
  before going live
- **Trend Micro branded** -- dark theme Chrome extension popup with session
  indicators, live counters, and S3 config panel

---

## Running Tests

```bash
npm test
```

Runs the full test suite: error classification, correlator, email template
generation, retry logic, and pipeline integration tests.

---

## Project Structure

```
boothapp/
  extension/              # Chrome extension (Manifest V3)
    manifest.json         #   extension config
    popup.html            #   branded popup UI
    popup.js              #   popup logic + S3 config
    content.js            #   click capture + session lifecycle
    background.js         #   screenshot capture + upload orchestration
    EXTENSION-GUIDE.md    #   usage guide
  analysis/               # Analysis pipeline
    watcher.js            #   session directory poller
    analyze.py            #   Python analysis entry point
    pipeline-run.js       #   pipeline runner
    lib/
      pipeline.js         #   multi-stage pipeline (download/transcribe/analyze)
      correlator.js       #   click+transcript+screenshot correlation
      email-template.js   #   follow-up email generator
      errors.js           #   error classification + retry
      error-writer.js     #   structured error JSON writer
      retry.js            #   exponential backoff utility
    test/                 #   test suite (103 tests)
  presenter/              # Dashboard server
    server.js             #   Express API + static serving
    demo.html             #   demo landing page
    sessions.html         #   session list page
  infra/                  # AWS infrastructure
    presign-lambda/       #   presigned URL generator
      index.js            #     Lambda handler
      template.yaml       #     SAM/CloudFormation template
    health.html           #   static health check
  scripts/
    preflight.sh          #   pre-demo verification (9 checks)
    test/
      test-demo-pipeline.sh  # e2e pipeline test
  package.json            # root dependencies + scripts
```

---

## Team

**Smells Like Machine Learning**

Built at the Trend Micro Hackathon 2026.

---

## License

Internal hackathon project. Not licensed for external distribution.
