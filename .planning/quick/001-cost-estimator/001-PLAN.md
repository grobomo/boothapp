# Cost Estimator Component

## Goal
Add a session cost estimator at `presenter/components/cost-estimator.js` that calculates and displays per-session AWS costs (S3, Lambda, Transcribe, Bedrock, Data Transfer) with a running total on the analytics page.

## Success Criteria
1. `presenter/components/cost-estimator.js` exists as a standalone ES module
2. Estimates S3 storage cost based on session data sizes (metadata, clicks, screenshots, transcript, analysis output)
3. Estimates Lambda invocation cost (session create/end)
4. Estimates AWS Transcribe cost per minute
5. Estimates Bedrock API token cost (input + output)
6. Estimates data transfer cost
7. Uses realistic AWS pricing: S3 $0.023/GB, Lambda $0.20/1M invocations, Transcribe $0.024/min, Bedrock Sonnet ~$3/1M input tokens
8. Renders a small card showing per-session cost breakdown
9. Shows running total across sessions
10. Integrable into the existing demo.html analytics page
