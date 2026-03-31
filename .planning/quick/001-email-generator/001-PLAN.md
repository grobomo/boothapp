# Email Generator

## Goal
Create `presenter/email-generator.html` -- a follow-up email template generator that takes session analysis data from S3 and generates a personalized HTML email ready to copy/send.

## Success Criteria
- [x] Loads session data (summary.json, metadata.json, follow-up.json) from S3
- [x] Generates personalized greeting with visitor name
- [x] Shows summary of what was demonstrated (products list)
- [x] Highlights visitor's key interests with evidence
- [x] Proposes next steps from follow_up_actions
- [x] Includes calendar link (mailto/Google Calendar) to schedule follow-up
- [x] Clean professional email template with copy-to-clipboard
- [x] Matches existing presenter dark theme (admin pages) with light email preview
- [x] Accessible via ?session=SESSION_ID query param
