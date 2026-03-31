# BoothApp Quick Start Guide

New team member? Follow these steps to get BoothApp running on your demo PC.

---

## Prerequisites

- Google Chrome (latest)
- Android phone with BoothApp installed (or use manual session start)
- AWS credentials for the `boothapp-sessions` S3 bucket
- USB microphone plugged into demo PC

---

## Step 1: Install the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo

<!-- Screenshot: chrome://extensions with V1-Helper loaded -->
![Chrome extensions page with V1-Helper loaded](screenshots/ext-installed.png)

You should see **V1-Helper** appear with the Trend Micro icon. Pin it to your toolbar for easy access.

---

## Step 2: Configure S3 Credentials

1. Click the **V1-Helper** icon in the Chrome toolbar
2. Click the **gear icon** (top-right) to open Settings
3. Fill in the S3 configuration:

| Field | Value |
|-------|-------|
| S3 Bucket | `boothapp-sessions-752266476357` |
| AWS Region | `us-east-1` |
| Presign Endpoint URL | *(ask Joel for the Lambda Function URL)* |
| Access Key ID | *(from AWS hackathon profile)* |
| Secret Access Key | *(from AWS hackathon profile)* |
| Session Token | *(optional -- only if using temporary credentials)* |

> **Shortcut:** Click **Pre-fill Demo** to auto-populate the bucket and region, then paste the Lambda URL and credentials.

4. Choose screenshot quality (Medium/720p recommended for demos)
5. Click **Save**
6. The **S3** indicator in the header turns green when connected

<!-- Screenshot: V1-Helper popup with S3 config open -->
![V1-Helper settings panel](screenshots/ext-s3-config.png)

---

## Step 3: Start a Demo Session

### Option A: Badge Scan (production flow)

1. Open the **BoothApp** Android app
2. Tap **Scan Badge** and photograph the visitor's badge
3. The app OCRs the badge, creates a session, and uploads to S3
4. The Chrome extension detects the new session automatically (S3 polling)
5. The status ring turns red and shows **REC**

### Option B: Manual Start (testing / no phone)

1. Click the **V1-Helper** icon in the toolbar
2. Click **Start Demo**
3. A session ID is generated automatically (`manual-<timestamp>`)
4. The status ring turns red and shows **REC**

### Option C: Pair Mobile App (QR code)

1. Click **Pair Mobile App** in the extension popup
2. Scan the QR code with the BoothApp Android app
3. This shares S3 credentials with the phone so it can start sessions

<!-- Screenshot: Extension showing REC state with timer running -->
![Active recording session](screenshots/ext-recording.png)

---

## Step 4: Demo Vision One Features

With the session active, demo normally in the browser. The extension captures:

- **Every click** -- element, coordinates, timestamp, page URL
- **Screenshots** -- automatic captures on navigation and significant clicks
- **Page transitions** -- full browsing path through V1

Tips:
- Keep the demo focused (5-15 minutes is ideal)
- Narrate what you are showing -- the USB mic records audio for transcript
- The click counter and screenshot counter update live in the popup

---

## Step 5: End the Session

### From Chrome Extension
1. Click the **V1-Helper** icon
2. Click **End Demo**
3. The ring shows a blue spinner while uploading captured data to S3
4. When complete, the ring shows a green checkmark

### From Android App
1. Tap **End Session** in the BoothApp app
2. The extension detects the end signal via S3 and stops recording

<!-- Screenshot: Extension showing upload complete checkmark -->
![Session complete](screenshots/ext-complete.png)

---

## Step 6: View Analysis Results

Once the session ends and all data is uploaded:

1. The **watcher** service detects the completed session in S3
2. Claude analyzes the audio transcript + screenshots + click data
3. A summary is generated at `s3://boothapp-sessions-752266476357/sessions/<session-id>/output/summary.html`

To view results:
- Open the **Presenter Dashboard** at `http://localhost:3000` (run `cd presenter && npm start`)
- Navigate to **Sessions** to see all completed sessions
- Click a session to view the AI-generated summary, timeline, and follow-up recommendations

<!-- Screenshot: Presenter dashboard showing session summary -->
![Session analysis results](screenshots/presenter-summary.png)

---

## Troubleshooting

### S3 indicator stays red
- Verify credentials are correct (no extra spaces)
- Check that the Presign Endpoint URL is a valid Lambda Function URL
- Try clicking **Save** again -- the extension re-tests the connection on save
- Open Chrome DevTools on the popup (right-click popup > Inspect) and check the Console for errors

### Extension not capturing clicks
- Make sure the session is active (red REC ring)
- Check that the content script is injected: open DevTools on the demo page and look for `[V1-Helper]` console messages
- Try reloading the page -- the content script injects on page load

### Badge scan not starting a session
- Confirm the Android app has the same S3 bucket and credentials
- Use **Pair Mobile App** QR code to sync credentials
- Check the Android app logs for upload errors
- Fall back to **Start Demo** (manual) if the phone is not cooperating

### Audio not recording
- Verify the USB microphone is plugged in and selected as the default input device
- Check Chrome microphone permissions: `chrome://settings/content/microphone`
- The audio capture runs separately from the extension -- see `audio/` for setup

### Upload stuck (spinner won't stop)
- Check your internet connection
- Open Chrome DevTools on the popup and check Console/Network for failed requests
- If the Lambda endpoint is down, uploads queue locally and retry automatically
- As a last resort: end the session from the Android app, which triggers a server-side cleanup

### Presenter dashboard won't start
- Run `cd presenter && npm install` first
- Make sure port 3000 is not in use: `lsof -i :3000`
- Check `presenter/server.js` logs for errors

### No analysis output after session ends
- The watcher must be running: `cd analysis && node watcher.js`
- Check watcher logs for errors: the watcher polls S3 for completed sessions
- Verify all session files uploaded (metadata.json, clicks.json, screenshots, audio)
- Check CloudWatch logs for the analysis Lambda if using the cloud pipeline

---

## Quick Reference

| Action | How |
|--------|-----|
| Install extension | `chrome://extensions` > Load unpacked > `extension/` |
| Configure S3 | Gear icon > fill fields > Save |
| Start session (manual) | Click V1-Helper > Start Demo |
| Start session (badge) | Android app > Scan Badge |
| End session | Click V1-Helper > End Demo |
| View results | `http://localhost:3000` > Sessions |
| Check watcher | `cd analysis && node watcher.js` |
| Run presenter | `cd presenter && npm start` |
