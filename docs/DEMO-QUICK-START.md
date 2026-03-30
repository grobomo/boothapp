# Demo Quick Start

1. **Pre-reqs:** Chrome browser, USB microphone, and an Android phone with a camera.
2. **Start a session:** POST to the Lambda endpoint, or upload `metadata.json` to the S3 intake bucket.
3. **Chrome extension auto-starts** when it detects `active-session.json` in the session bucket.
4. **Walk through the V1 demo.** The extension captures every click and takes timestamped screenshots.
5. **End the session:** POST to the Lambda endpoint, or upload `end.json` to the session bucket.
6. **Watcher detects completion** and triggers the analysis pipeline automatically.
7. **Output:** `summary.html` is written to the S3 output bucket when analysis finishes.
