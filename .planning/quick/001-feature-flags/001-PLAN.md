# Feature Flags System

## Goal

Add a JSON-based feature flags system at `infra/feature-flags.js` that allows the team to enable/disable optional features during the live demo without code changes.

## Success Criteria

1. `infra/flags.json` exists with default flag values for: audio_recording, badge_ocr, competitive_analysis, email_drafts, cost_estimation
2. `infra/feature-flags.js` exports a `getFlag(name)` function that reads flags
3. Admin UI section on the presenter page to toggle flags with visual feedback
4. All optional features check flags before executing (demo.html integration)
5. Flags persist to localStorage and include S3 sync capability
6. Works in-browser (no Node.js server required for basic usage)
