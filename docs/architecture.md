# Architecture Overview

BoothApp captures user interactions during booth demos and produces AI-driven session analyses. The system has four major components that work together through S3 as the shared data plane.

## Components

### Chrome Extension (`extension/`)

Runs in the browser and records every user interaction -- clicks, navigation, and periodic screenshots. Events are timestamped and written to a local buffer, then flushed to S3 under the active session prefix. The extension popup shows session status and S3 configuration.

### Audio Recorder (`audio/`)

Captures microphone input for the duration of a session. Audio segments are uploaded to S3 alongside the click and screenshot data so the analysis pipeline can correlate spoken commentary with on-screen actions.

### Session Orchestrator (`infra/`)

An AWS Lambda function that manages session lifecycle: start, stop, and status. It writes `active-session.json` to S3 so the Chrome extension and audio recorder know which session is live. Session metadata (timestamps, participant info) is stored in S3 as structured JSON.

### Analysis Pipeline (`analysis/`)

Runs after a session ends. The pipeline:

1. Loads the click timeline, screenshots, and audio from S3.
2. Correlates events into a unified, time-ordered transcript.
3. Sends the correlated data to Claude for qualitative analysis (interest signals, engagement patterns, key moments).
4. Writes the final report back to S3.

The Claude client supports both direct API and Bedrock invocation.

## Data Flow

```
Browser clicks/screenshots --\
                               +--> S3 session prefix --> Analysis Pipeline --> Claude --> Report
Microphone audio -----------/
                ^
                |
        Session Orchestrator (Lambda)
        creates/manages session metadata
```

## Key Design Decisions

- **S3 as the shared bus.** All components read and write to S3, keeping them decoupled. No direct service-to-service calls during capture.
- **Timestamped everything.** Every click, screenshot, and audio chunk carries a UTC timestamp so the pipeline can reconstruct exact ordering.
- **Stateless Lambda orchestrator.** Session state lives in S3, not in the Lambda. The orchestrator is a thin coordinator.
