# Email Template Generator

## Goal
Add `analysis/engines/email_template.py` that generates a `follow-up-email.html` visitor email from summary.json data. Integrates into the existing analysis pipeline after summary.json/summary.html generation.

## Success Criteria
1. `email_template.py` generates valid HTML email from summary + follow_up data
2. Email includes: visitor name, products discussed, personalized recommendations, CTA to schedule follow-up
3. Uses Trend Micro email branding (consistent with existing email-report.js style)
4. Integrated into `analyzer.py` so `analyze()` returns email HTML in results dict
5. Integrated into `analyze.py` CLI so email is written to output dir
6. Integrated into `pipeline-run.js` so email is generated alongside other outputs
7. Unit tests pass
8. Existing tests still pass
