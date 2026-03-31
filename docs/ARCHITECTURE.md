# BoothApp System Architecture

BoothApp captures booth demo interactions and produces AI-driven session reports.
Four components communicate through S3 as the shared data plane.

## Components

### Chrome Extension (`extension/`)
Records clicks, navigation events, and periodic screenshots in the browser.
Events are timestamped, buffered locally, then flushed to S3 under the
active session prefix. The popup UI shows session status and S3 config.

### Audio Recorder (`audio/`)
Captures microphone input for the session duration. Audio segments upload
to S3 alongside click and screenshot data so the analysis pipeline can
correlate spoken commentary with on-screen actions.

### Session Orchestrator (`infra/`)
AWS Lambda that manages session lifecycle (start, stop, status). Writes
`active-session.json` to S3 so capture components know which session is
live. Session metadata (timestamps, participant info) is stored as JSON.

### Analysis Pipeline (`analysis/`)
Runs after a session ends:
1. Loads the click timeline, screenshots, and audio transcript from S3.
2. Correlates events into a unified time-ordered transcript.
3. Sends correlated data to Claude for qualitative analysis.
4. Writes the final report back to S3.

Supports both direct Anthropic API and AWS Bedrock invocation.

## Data Flow

```
Browser (clicks + screenshots) --\
                                  +--> S3 session prefix --> Pipeline --> Claude --> Report
Microphone (audio segments) ----/
                 ^
                 |
         Session Orchestrator (Lambda)
         creates / manages session metadata
```

## Key Design Decisions

- **S3 as shared bus** -- all components read/write S3, no direct
  service-to-service calls during capture.
- **Timestamps everywhere** -- every click, screenshot, and audio chunk
  carries a UTC timestamp for exact ordering during correlation.
- **Stateless orchestrator** -- session state lives in S3, not in Lambda.
