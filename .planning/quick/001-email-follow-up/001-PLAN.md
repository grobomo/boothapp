# Email Follow-Up Template Generator

## Goal

Add an email follow-up template generator that takes booth session analysis output (topics, engagement scores, transcript excerpts) and produces personalized follow-up email templates for sales reps to send to booth visitors.

## Success Criteria

1. Module `analysis/lib/email-template.js` generates structured email templates from correlator output
2. Templates are personalized based on detected product topics and engagement level
3. High-engagement visitors get detailed technical follow-up; low-engagement get general interest nurture
4. Each topic maps to relevant product-specific content blocks
5. Unit tests in `analysis/test/email-template.test.js` cover all engagement tiers and topic combinations
6. Existing tests continue to pass (`npm test`)
7. Module integrates with existing pipeline output format (correlator's `{ segments, summary }`)
