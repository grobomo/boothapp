# Changelog

All notable changes to BoothApp, organized by date.

## 2026-03-31

### Security
- #113 Session ID validation -- rejects non-alphanumeric, empty, null, path traversal, and overlength IDs with HTTP 400; 13 new unit tests

### Fixes
- #114 Correlator error handling -- guard parseOffset against non-string/empty input, skip events with missing timestamps
- #116 Fix extension manifest.json description to reflect BoothApp functionality

### Docs
- #112 Add JSDoc docstrings to top 3 exported functions in analysis/analyze.py

## 2026-03-30

### Features
- #104 Enrich correlator with screenshot matching, engagement scoring, topic detection
- #103 Session review dashboard (presenter/sessions.html)
- #100 Automated demo preflight check script
- #99 Redesign extension popup for demo readiness
- #98 Demo simulation script
- #95 Pre-signed URL support for Chrome extension uploads
- #86 Integrate screenshot listing into pipeline
- #74 Watcher health monitoring (analysis/watcher-health.js)
- #72 Integration verification test suite (38 checks across all components)
- #70 Session timeline viewer
- #69 Booth welcome page for demo PC idle screen
- #66 Red error state for popup hero indicator
- #64 Audio transcription integration test
- #63 Presenter dashboard with screenshot thumbnails and responsive layout
- #61 Trade-show quality HTML report
- #57 Presenter dashboard for live session display
- #56 Redesign popup with large status indicator and live stats
- #55 Error handling for analysis pipeline
- #54 Email-report.js for email-ready HTML output
- #50 validate-session.sh for S3 session validation
- #47 Improve Chrome extension popup UI
- #46 Session lifecycle state machine
- #44 Session review UI for SE approval workflow
- #43 Demo landing page for booth status display
- #42 Integration test for watcher/analysis pipeline
- #41 Pulse animation on session status badge
- #40 Status badge with pulse animation in Chrome extension popup
- #39 Notification system for analysis watcher
- #38 HTML report template with placeholder syntax
- #37 session_score, executive_summary, and enhanced key_moments
- #36 Demo session script for pipeline testing
- #35 Session analysis dashboard
- #34 Environment variable validation for analysis watcher
- #32 Health check script
- #31 Correlator error handling and partial timeline support

### Fixes
- #76 Orchestrator test CJS/ESM conflict
- #48 Lazy-load AWS SDK in render-report.js

### Docs
- #53 Demo walkthrough script for trade show prep
- #52 Comprehensive README.md
- #49 System Requirements section in README.md
- #33 S3 session data contract (SESSION-DATA-CONTRACT.md)
- #30 Chrome extension usage guide
- #29 Analysis pipeline flow documentation
- #28 Demo quick-start guide
- #26 Architecture overview

### Chores
- #45 Sync stale ana-02-correlator task status to completed
- #27 Add coverage/ and .tmp/ to .gitignore

## 2026-03-29

### Features
- #25 Pipeline component descriptions in analysis README
- #24 Health check endpoint on watcher (port 8090)
- #23 Bridge orchestrator to Chrome extension via active-session.json
- #21 S3 config section and session status in popup
- #19 Bedrock support for Claude analysis
- #18 HTML report renderer and configurable model
- #16 AWS Transcribe pipeline (aud-02)
- #15 Claude analysis engine: two-pass factual extraction + recommendations
- #13 Timestamp correlator -- align clicks + audio into unified timeline (ana-02)
- #10 Shared AWS config -- single source of truth for resource names/ARNs
- #9 Session watcher (ana-01)
- #8 S3 session polling and batch upload to V1-Helper
- #7 Silent screenshot capture on every click (ext-03)
- #6 Session lifecycle orchestrator (inf-04)
- #5 Click tracking module for V1-Helper extension
- #4 Session-triggered ffmpeg audio recorder (aud-01)
- #3 V1-Helper Chrome extension scaffold (ext-01 part 1)
- #1 S3 session storage bucket CloudFormation (inf-01-s3-setup)
