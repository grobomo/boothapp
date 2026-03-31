# Processing Dashboard

## Goal
Create a real-time processing dashboard showing the AI analysis pipeline stages with animated progress indicators and elapsed time tracking.

## Success Criteria
- [ ] Dashboard shows 6 pipeline stages: Session Received, Audio Transcription, Click Correlation, AI Analysis, Report Generation, Email Report
- [ ] Polls S3 session folder every 5 seconds to detect stage completion
- [ ] Shows elapsed time per stage with live-ticking timers
- [ ] Animated progress indicators (spinning ring on active stage, shimmer effect)
- [ ] Overall progress bar with percentage
- [ ] Completion banner with link to report
- [ ] Consistent dark theme matching existing presenter pages
- [ ] Auth-gated like all other presenter pages
