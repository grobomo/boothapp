# Data Contract — S3 Session Folder Structure

All three workstreams (Extension, Audio, Analysis) communicate ONLY through this S3 folder structure. No direct dependencies between workstreams.

## Session Folder

```
sessions/<session-id>/
├── metadata.json              # WHO: Android app / dispatcher
├── badge.jpg                  # WHO: Android app
├── audio/
│   └── recording.wav          # WHO: Workstream B (Audio)
├── transcript/
│   └── transcript.json        # WHO: Workstream B (Audio)
├── clicks/
│   └── clicks.json            # WHO: Workstream A (Extension)
├── screenshots/
│   ├── click-001.jpg          # WHO: Workstream A (on click)
│   ├── click-002.jpg
│   ├── periodic-001.jpg       # WHO: Workstream A (every N seconds)
│   └── ...
├── v1-tenant/
│   └── tenant.json            # WHO: Tenant pool manager
├── feedback.json              # WHO: Presenter (visitor feedback form)
└── output/
    ├── summary.html           # WHO: Workstream C (Analysis)
    ├── summary.json           # WHO: Workstream C (structured)
    ├── follow-up.json         # WHO: Workstream C (actions)
    └── follow-up-email.html   # WHO: Workstream C (visitor email template)
```

## Schema: metadata.json
```json
{
  "session_id": "A726594",
  "visitor_name": "Joel Ginsberg",
  "badge_photo": "badge.jpg",
  "started_at": "2026-08-05T14:32:00Z",
  "ended_at": "2026-08-05T14:47:00Z",
  "demo_pc": "booth-pc-3",
  "se_name": "Casey Mondoux",
  "audio_consent": true,
  "status": "completed"
}
```

## Schema: clicks.json
```json
{
  "session_id": "A726594",
  "events": [
    {
      "index": 1,
      "timestamp": "2026-08-05T14:32:15.123Z",
      "type": "click",
      "dom_path": "div.app-content > nav > a.endpoint-security",
      "element": {
        "tag": "a",
        "id": "ep-nav",
        "class": "endpoint-security",
        "text": "Endpoint Security",
        "href": "/app/endpoint-security"
      },
      "coordinates": {"x": 450, "y": 120},
      "page_url": "https://portal.xdr.trendmicro.com/app/dashboard",
      "page_title": "Vision One - Dashboard",
      "screenshot_file": "screenshots/click-001.jpg"
    }
  ]
}
```

## Schema: transcript.json
```json
{
  "session_id": "A726594",
  "source": "recording.wav",
  "duration_seconds": 900,
  "entries": [
    {
      "timestamp": "00:00:03.000",
      "speaker": "SE",
      "text": "Welcome, let me show you Vision One."
    },
    {
      "timestamp": "00:00:15.000",
      "speaker": "Visitor",
      "text": "Great, I'm interested in endpoint protection."
    }
  ]
}
```

## Schema: tenant.json
```json
{
  "session_id": "A726594",
  "tenant_url": "https://portal.xdr.trendmicro.com/...",
  "tenant_id": "abc123",
  "login_email": "visitor-a726594@demo.trendmicro.com",
  "created_at": "2026-08-05T14:00:00Z",
  "expires_at": "2026-09-04T14:00:00Z",
  "status": "active"
}
```

## Schema: summary.json
```json
{
  "session_id": "A726594",
  "visitor_name": "Joel Ginsberg",
  "products_demonstrated": ["Endpoint Security", "XDR", "Risk Insights"],
  "key_interests": [
    {"topic": "Endpoint policy management", "confidence": "high", "evidence": "Asked 3 questions about policy config"},
    {"topic": "XDR detection rules", "confidence": "medium", "evidence": "Spent 2 min on detection rules page"}
  ],
  "follow_up_actions": [
    "Send EP policy best practices guide",
    "Schedule deep-dive on XDR custom detection rules",
    "Share V1 tenant link for self-guided exploration"
  ],
  "demo_duration_seconds": 900,
  "session_score": 8,
  "executive_summary": "Visitor showed strong interest in endpoint policy management and XDR detection rules, asking detailed questions about BYOD scenarios. Recommend scheduling a deep-dive on custom detection rules within the next week.",
  "key_moments": [
    {"timestamp": "00:05:30", "screenshot": "click-012.jpg", "description": "Visitor asked about BYOD policy", "impact": "Indicates real-world deployment concern — strong buying signal"}
  ],
  "v1_tenant_link": "https://portal.xdr.trendmicro.com/...",
  "generated_at": "2026-08-05T15:02:00Z"
}
```

## Schema: follow-up.json
```json
{
  "session_id": "A726594",
  "visitor_email": "joel@example.com",
  "subject": "Your Vision One Demo Summary",
  "summary_url": "https://..../summary.html",
  "tenant_url": "https://portal.xdr.trendmicro.com/...",
  "priority": "high",
  "tags": ["endpoint", "xdr", "enterprise"],
  "sdr_notes": "Visitor is a CISO, 5000 endpoints, comparing with Palo Alto"
}
```

## Schema: feedback.json
```json
{
  "session_id": "A726594",
  "rating": 4,
  "rating_label": "Very Good",
  "products_interested": ["Endpoint Security", "XDR / Detection & Response", "Cloud Security"],
  "additional_comments": "Would love to see a BYOD policy walkthrough",
  "contact_preference": "email",
  "consent_to_contact": true,
  "submitted_at": "2026-08-05T15:10:00Z"
}
```

## Rules
- All timestamps are UTC ISO-8601
- All file paths are relative to the session folder
- Screenshots are JPEG, quality 60, max 1920x1080
- Audio is WAV, 44100Hz, stereo
- Session ID format: alphanumeric, 6-10 chars
- Any workstream can READ any file. Only WRITE to your own files.
