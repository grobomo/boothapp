# V1-Helper Chrome Extension Guide

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select the `extension/` directory from this repo
4. The V1-Helper icon appears in the Chrome toolbar

## Configuration

1. Click the V1-Helper extension icon to open the popup
2. Enter your AWS credentials:
   - **Access Key ID**
   - **Secret Access Key**
   - **Region** (e.g. `us-east-1`)
   - **S3 Bucket** name
3. Credentials are saved in Chrome's local storage via the `storage` permission

## How It Works

### Session Polling

The background service worker polls S3 for `active-session.json` every 5 seconds.
When the file exists and contains an active session, tracking begins automatically.

### Click Tracking

While a session is active, the content script captures every DOM click:
- **XPath** of the clicked element
- **X / Y coordinates** relative to the viewport

### Screenshots

A screenshot is taken on each click via the `tabs.captureVisibleTab` API
(requires the `activeTab` permission).

### Session End and Upload

When the session ends (the `active-session.json` file is removed or marked inactive),
the extension uploads the collected data to the S3 session folder:

```
s3://<bucket>/<session-id>/
  clicks.json        # Array of { xpath, x, y, timestamp } objects
  screenshots/       # PNG screenshot per click, named by timestamp
```

## Manifest Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Capture visible tab screenshots on click |
| `storage` | Persist AWS credentials locally |
| `tabs` | Access tab URL/title and capture screenshots |
| `<all_urls>` (host) | Inject content script and communicate with S3 on any page |
