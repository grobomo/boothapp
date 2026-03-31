# Plan: Session Export Feature

## Goal
Create `analysis/export.js` that takes a session ID, reads session data from S3, and generates a single self-contained HTML file with all data embedded (metadata, timeline, screenshots as base64 data URIs, summary, follow-up actions, engagement score). Output to `output/export.html`.

## Success Criteria
1. `analysis/export.js` exists and accepts a session ID argument
2. Reads session data from S3 (session JSON + screenshot images)
3. Converts screenshots to base64 data URIs for offline viewing
4. Generates self-contained HTML with all sections: metadata, timeline, screenshots, summary, actions, engagement score
5. Output written to `output/export.html`
6. HTML is viewable offline (no external dependencies)
7. HTML is printable (print styles)
8. Export button present in output
9. `package.json` with `@aws-sdk/client-s3` dependency
10. `output/` added to `.gitignore`
