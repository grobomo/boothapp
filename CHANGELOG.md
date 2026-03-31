# Changelog

All notable changes to BoothApp are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-03-31 (Demo Day Release)

### Added

- **Core Pipeline**
  - Initial project scaffold with analysis pipeline baseline ([#1](../../pull/1))
  - Session watcher health endpoint with status and timestamp ([#1](../../pull/1))
  - Error handling and resilience for the analysis pipeline ([#5](../../pull/5))
  - Error recovery with exponential backoff in session watcher
  - Session list API endpoint with S3 integration ([#15](../../pull/15))
  - Notification system for session analysis completion
  - WebSocket real-time update system for live session events

- **Chrome Extension**
  - Chrome extension popup with Trend Micro branding and dark theme ([#6](../../pull/6))
  - Session status colors and error handling in popup UI
  - Session timer overlay for active booth conversations
  - Chrome extension icons and BoothApp branding assets

- **Presenter UI**
  - Professional dark-themed presenter landing page for booth display
  - Demo landing page with particle effects and live dashboard ([#8](../../pull/8))
  - Session data viewer with full session detail display
  - Session search, filter, sort, and pagination
  - Session timeline visualization component with tests
  - Visitor summary card component for presenter view
  - Presenter settings page (S3, Lambda, model, display config)
  - Click heatmap visualization with session viewer
  - Session notes feature with S3 persistence and report integration
  - Dark-themed CSS design system (`presenter/styles/theme.css`)
  - Skeleton loading UI with animated placeholders and error states
  - Demo statistics dashboard for booth display
  - Admin panel with session management and watcher monitoring
  - Visitor check-in kiosk page for tablet self-service

- **Reports & Export**
  - Presentation-quality HTML report with V1 branding ([#13](../../pull/13))
  - Email follow-up template generator for post-session outreach ([#12](../../pull/12))
  - Post-session email drafter engine for personalized follow-up emails
  - Session export feature for standalone HTML reports
  - Print-friendly report view for booth session handouts
  - Visitor badge photo display in summary report

- **Correlator Engine**
  - Correlator module with comprehensive test suite (42 tests)
  - Enhanced correlator with screenshot, speaker, product, and clustering support
  - HTML report upgrade: dark gradient theme with correlator integration

- **Internationalization**
  - Multi-language support (English/Japanese) for presenter UI

### Changed

- Upgraded README with shields.io badges, Mermaid architecture diagram, and demo instructions ([#14](../../pull/14))
- Upgraded HTML report to dark gradient theme with correlator data

### Fixed

- Session ID validation and fallback warning in E2E test
- Entrypoint script to properly manage both watcher and server processes

### Infrastructure

- **CI/CD & Testing**
  - Unit tests (21 passing) and secret-scan CI workflow
  - E2E pipeline test script for full integration validation ([#16](../../pull/16))
  - Integration test for analysis pipeline
  - Unit tests for retry utility, pipeline timeout, timer overlay, and backup scripts
  - Test suite for timeline-viz component

- **Deployment**
  - Dockerfile and docker-compose.yml for containerized deployment
  - S3 session backup script with sync, compress, verify, and restore
  - Quick-start setup and start-all scripts

- **Documentation**
  - Comprehensive README with architecture, setup, and S3 data contract ([#14](../../pull/14))
  - CONTRIBUTING.md with getting started guide and PR guidelines
  - Badge template editor for conference badge OCR regions

- **Project Config**
  - `.github/publish.json` for grobomo account configuration
  - `test:integration` script added to package.json

## [0.1.0] - 2026-03-31 (Initial Baseline)

### Added

- Initial commit with boothapp baseline project structure
