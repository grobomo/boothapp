# BoothApp

### AI-Powered Trade Show Demo Capture

> Walk up. Demo. Walk away with a personalized AI-generated summary in your inbox.

BoothApp captures everything that happens during a live trade show demo --
screen clicks, audio, visitor badge photo -- and feeds it through an AI
analysis pipeline that produces a rich follow-up report, personalized to
exactly what the visitor saw and asked about.

---

## How It Works

```
 TRADE SHOW BOOTH                          AWS CLOUD
 +--------------------------+              +-------------------------------+
 |                          |              |                               |
 |  +--------------------+  |   presign   |  +-------------------------+  |
 |  | Chrome Extension   |------PUT------>|  |  S3 Bucket              |  |
 |  | - screen capture   |  |   Lambda    |  |  boothapp-sessions/     |  |
 |  | - click recorder   |  |             |  |    <session-id>/        |  |
 |  | - audio capture    |  |             |  |      metadata.json      |  |
 |  | - badge photo      |  |             |  |      audio.webm         |  |
 |  +--------------------+  |             |  |      clicks.json        |  |
 |           |               |             |  |      screenshots/       |  |
 |           | visitor       |             |  |      badge-photo.png    |  |
 |           | metadata      |             |  +----------|--|-----------+  |
 |           v               |             |             |  |              |
 |  +--------------------+  |             |             v  |              |
 |  | Popup UI           |  |             |  +------------+----------+   |
 |  | - start/stop       |  |             |  | Watcher               |   |
 |  | - visitor name     |  |             |  | - polls for new       |   |
 |  | - session status   |  |             |  |   sessions            |   |
 |  +--------------------+  |             |  | - health endpoint     |   |
 +--------------------------+              |  |   :8080               |   |
                                           |  +-----------|-----------+   |
                                           |              |               |
                                           |              v               |
                                           |  +-----------|-----------+   |
                                           |  | Analysis Pipeline     |   |
                                           |  | 1. Download assets    |   |
                                           |  | 2. Transcribe audio   |   |
                                           |  | 3. Correlate clicks   |   |
                                           |  |    + transcript       |   |
                                           |  | 4. Bedrock (Claude)   |   |
                                           |  |    analysis           |   |
                                           |  | 5. Render HTML report |   |
                                           |  | 6. Email follow-up    |   |
                                           |  +-----------|-----------+   |
                                           |              |               |
                                           |              v               |
                                           |  +-----------------------+   |
                                           |  | Presenter Dashboard   |   |
                                           |  | - session list        |   |
                                           |  | - live status         |   |
                                           |  | - summary reports     |   |
                                           |  | :3000                 |   |
                                           |  +-----------------------+   |
                                           +-------------------------------+
```

---

## Components

| Component | Path | Description |
|-----------|------|-------------|
| **Chrome Extension** | `extension/` | Manifest V3 extension that captures screen clicks, takes screenshots, records audio, and uploads everything to S3 via presigned URLs. Includes a branded popup for session control. |
| **Audio Recorder** | `extension/content.js` | Content script injected into every tab. Captures microphone audio as WebM and streams click coordinates + timestamps for timeline correlation. |
| **Transcriber + Analyzer** | `analysis/` | Node.js watcher service that polls S3 for new sessions, downloads assets, transcribes audio, and runs the full analysis pipeline with retry and error classification. |
| **Session Orchestrator** | `analysis/lib/pipeline.js` | Core pipeline engine: download -> transcribe -> correlate -> analyze (Bedrock/Claude) -> render report -> send email. Each stage has independent retry with exponential backoff. |
| **Analysis Pipeline** | `analysis/lib/` | Supporting modules -- click/transcript correlator, HTML report renderer, email follow-up template generator, error classifier, and retry logic. |
| **Presenter Dashboard** | `presenter/` | Express server that reads session data from S3 and serves a live dashboard at `:3000`. Includes a session list API, demo landing page, and per-session summary reports. |

### Infrastructure

| Component | Path | Description |
|-----------|------|-------------|
| **Presign Lambda** | `infra/presign-lambda/` | API Gateway Lambda that generates presigned S3 PUT URLs. The extension calls this to get upload permissions without embedding AWS credentials in the browser. |
| **Preflight Script** | `scripts/preflight.sh` | Automated pre-demo checker. Validates AWS credentials, S3 bucket access, Lambda health, extension files, and Node dependencies. Green/red pass/fail output. |

---

## S3 Data Contract

Every demo session writes to a single S3 prefix:

```
s3://boothapp-sessions/<session-id>/
    metadata.json          # visitor name, timestamp, session status
    audio.webm             # full demo audio recording
    clicks.json            # timestamped click coordinates + page URLs
    badge-photo.png        # visitor badge photo (camera capture)
    screenshots/
        click-001.jpg      # screenshot at each captured click
        click-002.jpg
        ...
    output/
        analysis.json      # Bedrock/Claude analysis result
        report.html        # rendered HTML summary report
        email.html         # follow-up email template
        error.json         # pipeline error details (if failed)
```

### metadata.json

```json
{
  "session_id": "sess-20260331-143052",
  "visitor_name": "Jane Smith",
  "created_at": "2026-03-31T14:30:52.000Z",
  "status": "complete",
  "booth_rep": "Demo Station 3"
}
```

### Allowed upload types (presign Lambda)

| Type | Content-Type | S3 Key |
|------|-------------|--------|
| `metadata` | `application/json` | `<session-id>/metadata.json` |
| `audio` | `audio/webm` | `<session-id>/audio.webm` |
| `clicks` | `application/json` | `<session-id>/clicks.json` |
| `screenshot` | `image/png` | `<session-id>/screenshots/<filename>` |

---

## Setup

### Prerequisites

- Node.js >= 18
- AWS CLI configured (profile: `hackathon`)
- Chrome (for extension side-loading)
- Python 3.10+ (for Bedrock analysis script)

### Install

```bash
git clone https://github.com/grobomo/boothapp.git
cd boothapp
npm install
```

### Run the Watcher (analysis pipeline)

```bash
export AWS_PROFILE=hackathon
export S3_BUCKET=boothapp-sessions
npm run watcher
# Health check: http://localhost:8080/health
```

### Run the Presenter Dashboard

```bash
cd presenter
npm install
node server.js
# Dashboard: http://localhost:3000
# Session list API: http://localhost:3000/api/sessions
```

### Load the Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** -> select the `extension/` directory
4. Pin the V1-Helper icon in the toolbar

### Run Preflight Check

```bash
bash scripts/preflight.sh
```

### Run Tests

```bash
npm test
```

---

## Tech Stack

```
+------------------+----------------------------------------+
| Layer            | Technology                             |
+------------------+----------------------------------------+
| Capture          | Chrome Extension (Manifest V3)         |
| Storage          | Amazon S3                              |
| Upload Auth      | API Gateway + Lambda (presigned URLs)  |
| Transcription    | Amazon Transcribe                      |
| AI Analysis      | Amazon Bedrock (Claude 3 Sonnet)       |
| Pipeline         | Node.js (watcher + pipeline engine)    |
| Dashboard        | Express.js + vanilla HTML              |
| Email            | HTML template generator                |
| Testing          | Custom test harness (Node.js assert)   |
+------------------+----------------------------------------+
```

---

## Team

```
 ____                _ _       _     _ _        __  __            _     _
/ ___| _ __ ___  ___| | |___  | |   (_) | _____|  \/  | __ _  ___| |__ (_)_ __   ___
\___ \| '_ ` _ \/ _ \ | / __| | |   | | |/ / _ \ |\/| |/ _` |/ __| '_ \| | '_ \ / _ \
 ___) | | | | | |  __/ | \__ \ | |___| |   <  __/ |  | | (_| | (__| | | | | | | |  __/
|____/|_| |_| |_|\___|_|_|___/ |_____|_|_|\_\___|_|  |_|\__,_|\___|_| |_|_|_| |_|\___|

 _                          _
| |    ___  __ _ _ __ _ __ (_)_ __   __ _
| |   / _ \/ _` | '__| '_ \| | '_ \ / _` |
| |__|  __/ (_| | |  | | | | | | | | (_| |
|_____\___|\__,_|_|  |_| |_|_|_| |_|\__, |
                                     |___/
```

**Smells Like Machine Learning** -- Hackathon 2026

---

<sub>Built with caffeine, Claude, and questionable demo booth Wi-Fi.</sub>
