# BoothApp

AI-powered demo capture system for trade show booths. Records everything during
a live product demo -- clicks, screenshots, audio -- then generates a
personalized follow-up summary for each visitor using Claude.

Built for Black Hat, Reinvent, and similar conferences where SEs give live
Vision One demos at the booth.

## How It Works

```
  Visitor walks up          SE runs demo             Session ends
  +-----------------+      +-----------------+      +-------------------+
  | Badge photo     |      | Chrome ext:     |      | All data uploads  |
  | (Android app)   |----->|  click tracking |----->| to S3             |
  | -> OCR -> name  |      |  screenshots    |      |                   |
  | -> session ID   |      | Audio recorder: |      | Claude analyzes:  |
  +-----------------+      |  mic capture    |      |  transcript       |
                           +-----------------+      |  clicks           |
                                                    |  screenshots      |
                                                    +--------+----------+
                                                             |
                                                             v
                                                    +-------------------+
                                                    | Output:           |
                                                    |  HTML summary     |
                                                    |  interest signals |
                                                    |  follow-up recs   |
                                                    |  V1 tenant link   |
                                                    +-------------------+
```

## Architecture

```
+------------------+     +---------------------------+     +------------------+
|  Android App /   |     |        AWS S3             |     |    Demo PC       |
|  Web Form        |     |  (session data store)     |     |                  |
|                  |     |                           |     | Chrome Extension |
| - Badge photo    |---->| sessions/<id>/            |<----| - Click tracking |
| - Start session  |     |   metadata.json           |     | - Screenshots    |
| - End session    |     |   clicks/clicks.json      |     |                  |
+------------------+     |   screenshots/*.jpg       |     | Audio Recorder   |
                         |   audio/recording.wav     |<----| - USB mic capture|
                         |   transcript/             |     | - WAV output     |
                         |   output/summary.html     |     +------------------+
                         |   output/summary.json     |
                         |   v1-tenant/tenant.json   |
                         +------------+--------------+
                                      |
                         +------------v--------------+
                         |  Analysis Pipeline        |
                         |                           |
                         | 1. Watcher polls S3       |
                         | 2. Correlator merges      |
                         |    clicks + transcript    |
                         | 3. Claude analyzes        |
                         |    (Bedrock or direct)    |
                         | 4. HTML report generated  |
                         +---------------------------+
                                      |
                         +------------v--------------+
                         |  Session Orchestrator     |
                         |  (Lambda / Express)       |
                         |                           |
                         | - Create/end sessions     |
                         | - Demo PC command queue   |
                         | - V1 tenant pool mgmt    |
                         +---------------------------+
```

All components communicate exclusively through S3 -- no direct
service-to-service calls during capture. This keeps everything decoupled.

## Quick Start

### Prerequisites

- Node.js 18+
- AWS CLI configured (profile `hackathon`, region `us-east-1`)
- Chrome browser with Developer Mode enabled
- ffmpeg on PATH (for audio recording)
- Python 3.10+ (for analysis engine)

### 5 Steps to Run a Demo

```bash
# 1. Install all components
cd extension   # Load unpacked in chrome://extensions
cd audio       && npm install
cd analysis    && npm install && pip install anthropic anthropic[bedrock]
cd infra/session-orchestrator && npm install

# 2. Set environment variables (see full reference below)
export S3_BUCKET=boothapp-sessions-<account-id>
export AWS_REGION=us-east-1
export AWS_PROFILE=hackathon
export USE_BEDROCK=true
export ANALYSIS_MODEL=anthropic.claude-sonnet-4-6-20250514-v1:0

# 3. Start the session orchestrator
cd infra/session-orchestrator && node index.js
# Listening on port 3000

# 4. Start the analysis watcher
cd analysis && node watcher.js
# Polling S3 every 30s for completed sessions

# 5. Start the audio recorder on the demo PC
cd audio && node recorder.js
# Waiting for active session...
```

Then: open Chrome with the V1-Helper extension loaded, create a session via
the orchestrator API (`POST /session`), and run your demo. When you end the
session, all data uploads to S3 and the watcher triggers analysis
automatically.

## Component Inventory

| Component | Directory | Language | Purpose |
|-----------|-----------|----------|---------|
| Chrome Extension | `extension/` | JS | Click tracking + screenshots during demo |
| Audio Recorder | `audio/` | JS | USB mic capture, session-triggered start/stop |
| Audio Transcriber | `audio/transcriber/` | JS | WAV -> transcript via AWS Transcribe |
| Session Orchestrator | `infra/session-orchestrator/` | JS | Session lifecycle, demo PC commands, tenant pool |
| Analysis Watcher | `analysis/watcher.js` | JS | Polls S3 for completed sessions |
| Correlator | `analysis/lib/correlator.js` | JS | Merges clicks + transcript into unified timeline |
| Claude Analyzer | `analysis/engines/` | Python | Two-pass AI analysis of demo sessions |
| Report Renderer | `analysis/render-report.js` | JS | Generates self-contained HTML summary |
| Pipeline Runner | `analysis/pipeline-run.js` | JS | Orchestrates correlate -> analyze -> render |
| S3 Storage Config | `infra/s3-session-storage.yaml` | YAML | CloudFormation for session bucket |
| Helper Scripts | `scripts/` | Bash | demo-session, health-check, integration test |
| Demo UI | `demo/` | HTML | Landing page + session review interface |

## S3 Data Contract

All session data lives under `sessions/<session-id>/` in the shared bucket.
Components only write to their own files; any component can read any file.

```
sessions/<session-id>/
  metadata.json              # Session orchestrator -- visitor info, status, timestamps
  badge.jpg                  # Android app -- visitor badge photo
  audio/
    recording.wav            # Audio recorder -- 44100Hz stereo WAV
  transcript/
    transcript.json          # Transcriber -- timestamped speaker segments
  clicks/
    clicks.json              # Chrome extension -- click events with DOM paths
  screenshots/
    click-001.jpg            # Chrome extension -- JPEG q60, max 1920x1080
    periodic-001.jpg         # Chrome extension -- timed interval captures
  commands/
    start.json               # Orchestrator -- start signal for demo PC
    end.json                 # Orchestrator -- stop signal for demo PC
  output/
    summary.json             # Analysis pipeline -- structured results
    summary.html             # Report renderer -- self-contained HTML report
    follow-up.json           # Analysis pipeline -- SDR action items
  v1-tenant/
    tenant.json              # Orchestrator -- V1 tenant URL + credentials
```

Session status flow: `active` -> `ended` -> `analyzing` -> `complete`

See `DATA-CONTRACT.md` for full field-level schemas and
`infra/SESSION-DATA-CONTRACT.md` for IAM writer roles.

## Environment Variables

### Required (all components)

| Variable | Used By | Description |
|----------|---------|-------------|
| `S3_BUCKET` | all | S3 bucket name for session data |
| `AWS_REGION` | all | AWS region (default: `us-east-1`) |

### Authentication (one of these)

| Variable | Used By | Description |
|----------|---------|-------------|
| `AWS_PROFILE` | all | AWS credentials profile (default: `hackathon`) |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | all | Explicit AWS credentials |

### Audio Recorder (`audio/`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_ID` | Yes | -- | Session ID to record for |
| `AUDIO_DEVICE` | No | auto-detect | dshow device name (overrides auto-detect) |
| `POLL_INTERVAL_MS` | No | `2000` | S3 poll frequency in ms |
| `OUTPUT_DIR` | No | `./output/<SESSION_ID>` | Local WAV output directory |
| `SE_SPEAKER_LABEL` | No | `spk_0` | Speaker label for SE in transcription |

### Analysis Pipeline (`analysis/`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `USE_BEDROCK` | Yes | -- | `true` to use Amazon Bedrock for Claude calls |
| `ANALYSIS_MODEL` | Yes | `claude-sonnet-4-6` | Bedrock model ID or model name |
| `POLL_INTERVAL_SECONDS` | No | `30` | Watcher poll frequency |
| `HEALTH_PORT` | No | `8090` | Watcher health-check HTTP port |
| `WEBHOOK_URL` | No | -- | Webhook URL for session completion notifications |

### Claude API (when not using Bedrock)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RONE_AI_BASE_URL` | No | `https://api.anthropic.com` | Custom API base URL |
| `RONE_AI_API_KEY` | No | -- | API key (falls back to `ANTHROPIC_API_KEY`) |
| `ANTHROPIC_API_KEY` | No | -- | Anthropic API key |

### Session Orchestrator (`infra/session-orchestrator/`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |

## Project Structure

```
boothapp/
  CLAUDE.md                          # Project context and worker rules
  DATA-CONTRACT.md                   # S3 schema reference (field-level)
  PROJECT-PLAN.md                    # Integration map and source projects
  extension/                         # Chrome extension
    manifest.json                    #   Extension manifest (Manifest V3)
    background.js                    #   Service worker: S3 polling, screenshots
    content.js                       #   Content script: click interception
    popup.js                         #   Popup UI: config + session status
  audio/                             # Audio capture
    recorder.js                      #   Main entry: session-triggered recording
    lib/
      device-detect.js               #   USB mic auto-detection via ffmpeg
      ffmpeg-recorder.js             #   ffmpeg wrapper with graceful stop
      session-poller.js              #   S3 polling for session events
    transcriber/                     #   Post-session transcription
      index.js                       #     Entry point
      transcribe.js                  #     AWS Transcribe integration
      convert.js                     #     Audio format conversion
      upload.js                      #     Upload transcript to S3
  analysis/                          # Post-demo analysis
    watcher.js                       #   Polls S3 for completed sessions
    pipeline-run.js                  #   Single-session orchestration
    render-report.js                 #   HTML report generator
    analyze.py                       #   Claude analysis entry point
    engines/
      analyzer.py                    #   Two-pass Claude analysis
      claude_client.py               #   Bedrock/direct API client
      prompts.py                     #   Analysis prompt templates
    lib/
      correlator.js                  #   Merge clicks + transcript
      pipeline.js                    #   Pipeline utilities
      s3.js                          #   S3 read/write helpers
      notify.js                      #   Webhook notifications
    test/                            #   Unit and integration tests
    sample_data/                     #   Test fixtures
  infra/                             # AWS infrastructure
    session-orchestrator/
      index.js                       #   Express server entry point
      orchestrator.js                #   Session create/end logic
      s3.js                          #   S3 operations
      tenant-pool.js                 #   V1 tenant pool management
      deploy.sh                      #   Lambda deployment script
    s3-session-storage.yaml          #   CloudFormation template
    config.js / config.py            #   Shared config constants
  scripts/                           # Helper scripts
    demo-session.sh                  #   Create a test session end-to-end
    health-check.sh                  #   Check all services are running
    test-integration.sh              #   Integration test runner
  demo/                              # Demo UI
    index.html                       #   Landing page
    review.html                      #   Session review interface
  docs/                              # Documentation
    architecture.md                  #   Component overview
    DEMO-QUICK-START.md              #   Demo walkthrough
  .claude-tasks/                     #   CCC worker task files
```

## Troubleshooting

### Chrome extension not capturing clicks

- Verify the extension is loaded: `chrome://extensions` -> V1-Helper should
  show "Enabled"
- Check that S3 credentials are configured in the extension popup
- Confirm `active-session.json` exists in the S3 bucket root (the extension
  polls for this file to know when a session is active)
- Open DevTools -> Console for the extension's service worker to see errors

### Audio recorder can't find microphone

```bash
# List available audio devices
cd audio && npm run list-devices
```

If auto-detect picks the wrong device, set `AUDIO_DEVICE` explicitly:
```bash
export AUDIO_DEVICE="Microphone (Yeti Stereo)"
```

If no devices are found, check that ffmpeg is installed and the USB mic is
plugged in before starting the recorder.

### Watcher not picking up completed sessions

1. Check watcher health: `curl http://localhost:8090/health`
2. Verify `S3_BUCKET` and `AWS_REGION` are set
3. Confirm the session's `metadata.json` has `"status": "ended"` and
   `"upload_complete": true`
4. Check that both `clicks/clicks.json` and `transcript/transcript.json`
   exist in the session folder -- the watcher waits for all required files
5. Look for a `.analysis-claimed` marker -- another watcher instance may
   have already claimed the session

### Analysis fails or produces empty summary

- Check Claude API connectivity:
  - Bedrock: verify `USE_BEDROCK=true`, `ANALYSIS_MODEL` is a valid model ID,
    and AWS credentials have `bedrock:InvokeModel` permission
  - Direct: verify `ANTHROPIC_API_KEY` or `RONE_AI_API_KEY` is set
- Review `analyze.py` stderr output for API error messages
- Ensure the session has substantive click and transcript data (empty demos
  produce empty summaries)

### Session orchestrator returns 500

- Confirm `S3_BUCKET` is set and the bucket exists
- Check IAM permissions: the orchestrator needs `s3:PutObject`, `s3:GetObject`,
  `s3:ListBucket` on the session bucket
- Review the Express server logs for stack traces

### Demo PC not receiving start/stop commands

- Commands live at `commands/<demo_pc>/start.json` and `end.json` in S3,
  NOT inside `sessions/<id>/`
- The demo PC identifier must match exactly between the orchestrator request
  and what the PC polls for
- Check S3 bucket policy allows the demo PC's IAM role to read from
  `commands/` prefix

### Common S3 permission errors

```
AccessDenied: User: arn:aws:iam::...
```

Each component has its own IAM role (see `infra/s3-session-storage.yaml`):

| Role | Write Access |
|------|-------------|
| `boothapp-app-role` | `metadata.json`, `badge.jpg`, `commands/` |
| `boothapp-extension-role` | `clicks/`, `screenshots/` |
| `boothapp-audio-role` | `audio/`, `transcript/` |
| `boothapp-analysis-role` | `output/`, metadata status updates |

All roles have read access to the entire session folder.

## Team

Built by "Smells Like Machine Learning" for the 2026 hackathon.

## License

Internal use only.
