# BoothApp Project Plan — Existing Assets & Integration Map

## Source Projects

### 1. recording-analyzer → Audio Analysis Engine
**Source:** `ProjectsCL1/recording-analyzer/`
**Reuse:**
- `import.js` — VTT/TXT transcript parser -> normalized JSON
- `scripts/analyze.js` — Template-based analysis with Claude API
- `tools/frame-watcher/` — Video/screen frame change detection (SSIM-based)
  - `sources.py` — Frame source abstraction (video file OR live screen capture)
  - `differ.py` — Frame comparison (MAD fast pass + SSIM confirm)
  - `reporter.py` — Change event logging + frame saving
- `engines/` — Modular analysis engines (meeting-meta, next-steps, sentiment, etc.)
- `templates/` — Template definitions for different meeting types

**BoothApp use:** After demo ends, feed the audio transcript + frame watcher output into the analysis engine. Create a new "booth-demo" template that extracts: what was shown, what visitor asked about, interest signals, recommended follow-up.

**Key files to copy:**
- `tools/frame-watcher/` (entire directory) -> `boothapp/lib/frame-watcher/`
- `engines/meeting-meta.json`, `engines/next-steps.json` -> `boothapp/lib/analysis-engines/`
- `import.js` -> `boothapp/lib/transcript-parser/`

---

### 2. V1-Helper Chrome Extension (consolidated)
**Source:** Consolidated from 3 projects into `grobomo/v1-helper` branch `feature/chrome-extension`
- **Blueprint Extra MCP** (`extensions/`) — Extension architecture, popup, MCP relay (all 30 tools)
- **V1EGO** (`src/`) — Click interception, DOM path capture
- **V1-Helper** (`scripts/`) — Analysis/summary generation

**BoothApp use:** Single extension "V1-Helper" that:
- Keeps full Blueprint MCP browser automation (all 30 tools work)
- Intercepts all clicks, logs DOM path + timestamp + element info
- **Silent screenshot on every click** — `captureVisibleTab()`, no flash, no delay
- Periodic screenshot fallback (every N seconds)
- Session management via S3 polling (start/stop from Android app)
- Batch upload to S3 when session ends
- "Session tracked" banner at top of page
- TrendAI branding (logo, colors), no "Upgrade to Pro"

**See:** `v1-helper/PLAN-chrome-extension.md` for full implementation plan

---

### 3. blueprint-extra-mcp → Browser Automation
**Source:** `ProjectsCL1/MCP/blueprint-extra-mcp/`
**Reuse:**
- Full browser automation toolkit (navigate, click, type, screenshot, evaluate JS)
- iframe handling (V1 uses iframes heavily)
- Network request monitoring

**BoothApp use:**
- Automate V1 tenant provisioning (navigate portal, create tenant, extract credentials)
- Automate demo setup (pre-configure V1 tenant with sample data before visitor arrives)
- Testing: automated end-to-end test of the full demo flow
- Screen capture fallback if Chrome extension fails

**Integration:** Available to CCC workers via mcp-manager. Not copied into boothapp repo — used as a tool.

---

### 4. mcp-manager → Orchestrator
**Source:** `ProjectsCL1/MCP/mcp-manager/`
**Reuse:** As-is. Manages all MCP servers (blueprint-extra, v1-lite, wiki-lite, etc.)

**BoothApp use:** CCC workers running in RONE will have mcp-manager configured so they can use Blueprint for browser automation, v1-lite for API queries, wiki-lite for documentation lookup. Not copied — referenced as infrastructure.

---

### 5. credential-manager → Secrets Management
**Source:** `~/.claude/skills/credential-manager/`
**Reuse:** As-is. Stores/retrieves API keys from OS keyring.

**BoothApp use:**
- AWS credentials (hackathon account)
- V1 API keys (for tenant provisioning + data queries)
- Graph API tokens (for Teams poller)
- GitHub tokens (for repo operations)
- RONE AI endpoint key (for Claude API via RDSEC)

**Integration:** Referenced in k8s secrets + deploy scripts. Not in boothapp repo.

---

### 6. v1-helper → Report Generator
**Source:** `ProjectsCL1/v1-helper/`
**Reuse:**
- `scripts/report_generator.py` — Full pipeline: V1 API pull -> CVE analysis -> HTML report
- Report generation flow (load data, enrich with K8s context, Claude analysis, HTML output)
- HTML report template with interactive features
- Customer context system (`customers/<name>.md`)

**BoothApp use:** Adapt the report generator for booth demo context:
- Instead of container security CVEs, analyze the demo session data
- Input: transcript + click data + screenshots
- Output: "Demo Summary" HTML with what was shown, interest areas, recommended next steps
- Include V1 tenant link for visitor to continue exploring
- Email-ready format

**Key files to copy:**
- `scripts/report_generator.py` -> `boothapp/lib/report-generator/` (adapt heavily)
- HTML template patterns -> reuse for demo summary output

---

### 7. v1-api skill → V1 API Access
**Source:** `~/.claude/skills/v1-api/`
**Reuse:** Direct V1 API queries without MCP server overhead.

**BoothApp use:**
- V1 tenant pool management (create, list, preserve tenants)
- Pull demo tenant configuration after demo (what was changed)
- Query alerts/detections created during demo (to include in summary)

---

### 8. trend-docs skill → Documentation Lookup
**Source:** `~/.claude/skills/trend-docs/`
**Reuse:** Search and extract content from docs.trendmicro.com.

**BoothApp use:** CCC workers MUST use this before writing any V1-related code:
- Look up V1 API documentation for correct endpoints/params
- Research product features being demoed
- Verify best practices for configurations shown in demos

---

## Integration Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Demo PC                                                 │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ Chrome Extension │  │ Audio Recorder                │  │
│  │ (from v1ego)     │  │ (from meeting-recorder)       │  │
│  │ • Click tracking │  │ • System audio capture        │  │
│  │ • Screenshots    │  │ • Whisper transcription       │  │
│  │ • DOM capture    │  │                               │  │
│  └────────┬────────┘  └──────────────┬───────────────┘  │
│           └───────────┬──────────────┘                   │
│                       ▼                                  │
│              Session Upload to S3                        │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│  AWS S3 (Session Store)                                  │
│  sessions/<session-id>/                                  │
│  ├── audio.wav                                           │
│  ├── transcript.json    (from recording-analyzer)        │
│  ├── clicks.json        (from chrome extension)          │
│  ├── screenshots/       (from frame-watcher + ext)       │
│  ├── metadata.json      (badge photo, visitor name)      │
│  └── v1-tenant.json     (tenant URL + creds)             │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Analysis Pipeline (CCC worker or Lambda)                │
│  ┌──────────────────┐  ┌─────────────────────────────┐  │
│  │ Transcript Parser │  │ Frame Watcher Analysis      │  │
│  │ (from rec-analyzer│  │ (screenshot change detection)│  │
│  └────────┬─────────┘  └─────────────┬───────────────┘  │
│           └───────────┬───────────────┘                  │
│                       ▼                                  │
│           ┌──────────────────────┐                       │
│           │ Claude Analysis      │                       │
│           │ (booth-demo template)│                       │
│           │ • What was shown     │                       │
│           │ • Visitor interests   │                       │
│           │ • Follow-up recs     │                       │
│           └──────────┬───────────┘                       │
│                      ▼                                   │
│           ┌──────────────────────┐                       │
│           │ Report Generator     │                       │
│           │ (from v1-helper)     │                       │
│           │ • HTML summary       │                       │
│           │ • V1 tenant link     │                       │
│           │ • Email-ready        │                       │
│           └──────────────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

## What Gets Copied vs Referenced

### Copy into boothapp repo (adapt for booth context)
- `recording-analyzer/tools/frame-watcher/` -> `lib/frame-watcher/`
- `recording-analyzer/engines/` (selected) -> `lib/analysis-engines/`
- `recording-analyzer/import.js` -> `lib/transcript-parser/`
- `v1ego/src/` + `v1ego/manifest.json` -> `extension/` (heavy adaptation)
- `v1-helper/scripts/report_generator.py` patterns -> `lib/report-generator/`

### 9. meeting-recorder → Audio Capture
**Source:** `ProjectsCL1/meeting-recorder/`
**Reuse:**
- `record-audio-ffmpeg.sh` — ffmpeg DirectShow capture, WAV output, 44100Hz stereo
- Uses portable ffmpeg (`~/bin/ffmpeg-portable/bin/ffmpeg.exe`)
- Captures from Windows audio device via `-f dshow -i audio="<device>"`

**BoothApp use:**
- Capture demo conversation audio from wireless USB mic pack plugged into demo PC
- Session-triggered start/stop (not manual — controlled by S3 polling from Android app)
- Auto-detect audio device name on each PC (different hardware)
- Output WAV to session folder, upload to S3 when session ends
- Transcription happens post-upload (Whisper or similar, not real-time)

**Key adaptations:**
- Strip interactive prompts (countdown, manual start)
- Add device auto-detection: `ffmpeg -list_devices true -f dshow -i dummy`
- Add session ID tagging to output filename
- Add graceful stop (SIGINT on end-session signal)
- Consider capturing system audio (WASAPI loopback) in addition to mic for cases where demo includes audio/video playback

**Key files to copy:**
- `record-audio-ffmpeg.sh` patterns -> `boothapp/audio/recorder.sh` (adapt)

---

### Referenced as infrastructure (not copied)
- `mcp-manager` — CCC workers use it for tool access
- `blueprint-extra-mcp` — browser automation via mcp-manager
- `credential-manager` — secrets in OS keyring / k8s secrets
- `v1-api` skill — used by workers directly
- `trend-docs` skill — used by workers for research
- `msgraph-lib` — Teams messaging for status updates

## Proposed Repo Structure

```
boothapp/
├── CLAUDE.md                    # Project context (exists)
├── PROJECT-PLAN.md              # This file
├── .claude-tasks/               # Task files for CCC workers
├── extension/                   # Chrome extension (forked from v1ego)
│   ├── manifest.json
│   └── src/
│       ├── click-tracker.js     # Intercept + log clicks
│       ├── screenshot.js        # Periodic + on-click screenshots
│       ├── session-manager.js   # Start/stop via S3 polling
│       ├── banner.js            # "Session tracked" UI
│       └── uploader.js          # S3 upload module
├── audio/                       # Audio recording + transcription
│   ├── recorder.sh              # ffmpeg DirectShow capture (from meeting-recorder)
│   ├── device-detect.sh         # Auto-detect audio input device name
│   ├── transcriber.py           # Audio -> text (Whisper or cloud STT)
│   └── README.md                # Setup: ffmpeg-portable path, USB mic config
├── lib/
│   ├── frame-watcher/           # Screen change detection (from recording-analyzer)
│   ├── analysis-engines/        # Analysis templates
│   ├── transcript-parser/       # VTT/audio transcript parser
│   └── report-generator/        # HTML summary generator (from v1-helper)
├── session/                     # Session management
│   ├── s3-client.js             # S3 read/write for session data
│   ├── poller.js                # PC polls S3 for start/stop commands
│   └── uploader.js              # Upload all session data to S3
├── tenant-pool/                 # V1 tenant pool manager
│   ├── provisioner.js           # Create/preserve V1 tenants
│   ├── pool-manager.js          # Track active/warming/buffer tenants
│   └── tests/                   # Load simulation tests
├── analysis/                    # Post-demo analysis pipeline
│   ├── pipeline.js              # Orchestrate: parse + analyze + report
│   └── booth-demo-template.json # Analysis template for booth demos
└── web/                         # SDR review interface
    ├── dashboard.js             # Session list + status
    └── viewer.js                # View individual demo summaries
```
