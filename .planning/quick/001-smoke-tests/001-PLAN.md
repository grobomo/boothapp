# Smoke Test: All Presenter Pages

## Goal
Create tests/smoke/test-all-pages.js that verifies all presenter pages load correctly before demo day.

## Success Criteria
1. Test fetches each page and verifies HTTP 200
2. Test verifies expected title or heading in HTML
3. Test verifies nav component presence (links between pages)
4. Test checks for missing script imports (broken JS references)
5. Uses Node.js http module (no external deps)
6. Exit 0 if all pass, non-zero on failure
7. Pages that don't exist yet are reported as failures (smoke test catches gaps)

## Discovery
Only 3 HTML pages exist in presenter/:
- demo.html (title: "BoothApp - AI-Powered Trade Show Demo Capture")
- sessions.html (title: "BoothApp - Sessions")
- export.html (title: "BoothApp - Data Export Dashboard")

The request lists 16 pages. The 13 missing pages will be reported as failures -- that's the point of a pre-demo-day smoke test.

## Approach
- Start the Express server on a test port
- Test each page with http.get
- Check status, title, nav links, script src integrity
- Clean shutdown after tests
