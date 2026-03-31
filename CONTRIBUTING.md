# Contributing to BoothApp

## Getting Started

```bash
git clone https://github.com/grobomo/boothapp.git
cd boothapp
npm install                    # root deps (AWS SDK, Bedrock)
cd presenter && npm install    # presenter server deps (Express)
```

Configure environment variables (or use defaults):

| Variable | Default | Purpose |
|----------|---------|---------|
| `S3_BUCKET` | `boothapp-sessions` | S3 bucket for session data |
| `AWS_REGION` | `us-east-1` | AWS region |
| `PORT` | `3000` | Presenter server port |
| `HEALTH_PORT` | `8080` | Watcher health endpoint port |
| `POLL_INTERVAL_MS` | `5000` | Watcher polling interval |

Run `bash scripts/preflight.sh` to verify your environment is ready.

## Project Structure

```
boothapp/
  analysis/            # Session analysis pipeline
    lib/               # Pipeline internals (errors, retry, correlator, email)
    test/              # Unit tests (Node.js assert)
    watcher.js         # Watches for new sessions, triggers pipeline
    pipeline-run.js    # Pipeline entry point
    analyze.py         # Python analysis script
  presenter/           # Express server for demo UI
    server.js          # API + static file server
    demo.html          # Trade show demo landing page
    sessions.html      # Session list dashboard
    print-report.html  # Print-friendly report view
  extension/           # Chrome extension (Manifest V3)
    manifest.json      # Extension config
    background.js      # Service worker
    content.js         # Content script (injected into pages)
    popup.html/js      # Extension popup UI
  scripts/             # Operational scripts
    preflight.sh       # Pre-demo environment checker
    test/              # E2E test scripts
  infra/               # AWS infrastructure (Lambda, SAM templates)
  output/              # Generated reports
  specs/               # Feature specifications
```

## Adding a New Presenter Page

1. Create an HTML file in `presenter/` (e.g. `my-page.html`).
2. Use the dark theme styles consistent with `demo.html` and `sessions.html`.
3. The Express server serves all files in `presenter/` as static assets -- no route registration needed.
4. If the page needs API data, add an endpoint in `presenter/server.js` following the existing `/api/sessions` pattern.
5. Link to the new page from `demo.html` or `sessions.html` as appropriate.

## Adding a New Analysis Engine

1. Create a module in `analysis/lib/` exporting an async function.
2. Integrate it into the pipeline in `analysis/lib/pipeline.js` -- each step follows the `runPipeline(ctx)` pattern with retry wrapping.
3. Use `classifyError()` from `analysis/lib/errors.js` to categorize failures as transient or permanent.
4. Wrap with `retryWithBackoff()` from `analysis/lib/retry.js` for transient errors.
5. Write errors to `error.json` via `writeErrorJson()` so the dashboard can display them.
6. Add unit tests in `analysis/test/` using Node.js built-in `assert` (see existing tests for patterns).

## Modifying the Chrome Extension

The extension uses Manifest V3 with a service worker architecture:

- **`manifest.json`** -- permissions, content script matching, service worker registration.
- **`background.js`** -- service worker handling extension lifecycle events.
- **`content.js`** -- injected into matched pages; communicates with background via `chrome.runtime`.
- **`popup.html` / `popup.js`** -- extension popup UI.

To add a new permission, update the `permissions` or `host_permissions` array in `manifest.json`. After changes, reload the extension in `chrome://extensions` with Developer mode enabled.

See `extension/EXTENSION-GUIDE.md` and `extension/README.md` for detailed docs.

## Coding Standards

- **ES modules and CommonJS** -- analysis and presenter code use `require()`/CommonJS. Follow the existing pattern in each directory.
- **Async/await** -- use `async`/`await` for all asynchronous operations. No raw promise chains or callbacks.
- **Error handling** -- classify errors with `analysis/lib/errors.js`. Write structured error JSON for pipeline failures.
- **Dark theme** -- all UI pages use a dark color scheme. Match existing styles in `demo.html` and `sessions.html`.
- **No unnecessary dependencies** -- keep `package.json` lean. Prefer built-in Node.js modules where possible.

## PR Guidelines

- **One feature per PR** -- keep changes focused and reviewable.
- **Include screenshots** for any UI changes (presenter pages, extension popup, reports).
- **Run tests before submitting** -- all tests must pass.
- **Write a clear description** -- explain what changed and why.
- **Squash merge** -- PRs are squash-merged into main.

## Running Tests

```bash
# Unit tests (from repo root)
npm test

# This runs all analysis tests:
#   analysis/test/errors.test.js
#   analysis/test/correlator.test.js
#   analysis/test/email-template.test.js
#   analysis/test/retry.test.js
#   analysis/test/pipeline-run.test.js

# E2E test
bash scripts/test/test-demo-pipeline.sh

# Preflight environment check
bash scripts/preflight.sh
```

## Architecture Decision Records

ADRs are tracked as feature specs in the `specs/` directory. Each feature has `spec.md` (what and why), `plan.md` (how), and `tasks.md` (work breakdown). Review existing specs before proposing changes to established patterns.
