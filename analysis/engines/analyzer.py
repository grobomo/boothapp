import json
import os
import base64
import re
from datetime import datetime, timezone

from .claude_client import get_client
from .prompts import (
    SYSTEM_FACTUAL,
    SYSTEM_RECOMMENDATIONS,
    FACTUAL_EXTRACTION_PROMPT,
    RECOMMENDATIONS_PROMPT,
    render_html_report,
)

MODEL = os.environ.get("ANALYSIS_MODEL", "claude-sonnet-4-6")
MAX_TOKENS = 4096
MAX_SCREENSHOTS = 10


class SessionAnalyzer:
    def __init__(self, session_dir: str, s3_bucket: str = None):
        self.session_dir = session_dir
        self.s3_bucket = s3_bucket
        self._is_s3 = session_dir.startswith("s3://")
        self._s3_client = None
        self._metadata = {}
        self._transcript = {}
        self._clicks = {}
        self._tenant = {}

    def analyze(self) -> dict:
        self._load_inputs()
        timeline_text, screenshot_map = self._build_timeline_context()
        factual = self._pass1_factual_extraction(timeline_text, screenshot_map)
        recommendations = self._pass2_recommendations(factual)
        summary = self._build_summary_json(factual, recommendations)
        follow_up = self._build_follow_up_json(recommendations)
        html = render_html_report(summary, follow_up, factual)
        return {
            "summary": summary,
            "follow_up": follow_up,
            "html": html,
        }

    def _get_s3_client(self):
        if self._s3_client is None:
            import boto3
            self._s3_client = boto3.client("s3")
        return self._s3_client

    def _read_file(self, relative_path: str) -> bytes:
        if self._is_s3:
            prefix = self.session_dir.replace("s3://", "")
            bucket, _, key_prefix = prefix.partition("/")
            key = f"{key_prefix}/{relative_path}".lstrip("/")
            resp = self._get_s3_client().get_object(Bucket=bucket, Key=key)
            return resp["Body"].read()
        full_path = os.path.join(self.session_dir, relative_path)
        with open(full_path, "rb") as f:
            return f.read()

    def _read_json(self, relative_path: str) -> dict:
        data = self._read_file(relative_path)
        return json.loads(data)

    def _load_inputs(self):
        try:
            self._metadata = self._read_json("metadata.json")
        except Exception:
            self._metadata = {}

        try:
            self._transcript = self._read_json("transcript/transcript.json")
        except Exception:
            self._transcript = {}

        try:
            self._clicks = self._read_json("clicks/clicks.json")
        except Exception:
            self._clicks = {}

        try:
            self._tenant = self._read_json("v1-tenant/tenant.json")
        except Exception:
            self._tenant = {}

        if not self._transcript and not self._clicks:
            raise ValueError("No transcript and no clicks found — cannot analyze session")

    def _load_screenshot(self, filename: str) -> str:
        data = self._read_file(filename)
        return base64.b64encode(data).decode("utf-8")

    def _timestamp_to_seconds(self, ts: str) -> float:
        parts = ts.replace(",", ".").split(":")
        try:
            if len(parts) == 3:
                h, m, s = parts
                return int(h) * 3600 + int(m) * 60 + float(s)
            if len(parts) == 2:
                m, s = parts
                return int(m) * 60 + float(s)
            return float(parts[0])
        except (ValueError, IndexError):
            return 0.0

    def _pick_screenshot_indices(self, events: list) -> list:
        visitor_indices = [
            i for i, e in enumerate(events)
            if e.get("type") == "click" and e.get("speaker") == "Visitor"
        ]
        if len(visitor_indices) >= MAX_SCREENSHOTS:
            step = len(visitor_indices) // MAX_SCREENSHOTS
            return [visitor_indices[i * step] for i in range(MAX_SCREENSHOTS)]

        click_indices = [i for i, e in enumerate(events) if e.get("type") == "click"]
        if len(click_indices) <= MAX_SCREENSHOTS:
            return click_indices
        step = len(click_indices) // MAX_SCREENSHOTS
        return [click_indices[i * step] for i in range(MAX_SCREENSHOTS)]

    def _build_timeline_context(self) -> tuple:
        events = []

        for entry in self._transcript.get("entries", []):
            events.append({
                "type": "transcript",
                "timestamp": entry.get("timestamp", "00:00:00"),
                "seconds": self._timestamp_to_seconds(entry.get("timestamp", "00:00:00")),
                "speaker": entry.get("speaker", ""),
                "text": entry.get("text", ""),
            })

        for click in self._clicks.get("events", []):
            events.append({
                "type": "click",
                "timestamp": click.get("timestamp", ""),
                "seconds": 0,
                "index": click.get("index", 0),
                "element_text": click.get("element", {}).get("text", ""),
                "page_title": click.get("page_title", ""),
                "screenshot_file": click.get("screenshot_file", ""),
            })

        events.sort(key=lambda e: e.get("seconds", 0))

        screenshot_indices = self._pick_screenshot_indices(events)
        screenshot_map = {}
        for i in screenshot_indices:
            e = events[i]
            if e.get("type") == "click" and e.get("screenshot_file"):
                screenshot_map[i] = e["screenshot_file"]

        lines = []
        for i, e in enumerate(events):
            if e["type"] == "transcript":
                lines.append(f"[{e['timestamp']}] {e['speaker']}: {e['text']}")
            else:
                marker = " [SCREENSHOT]" if i in screenshot_map else ""
                lines.append(
                    f"[CLICK] #{e['index']} on '{e['element_text']}' — {e['page_title']}{marker}"
                )

        return "\n".join(lines), screenshot_map

    def _extract_json(self, text: str) -> dict:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if match:
            text = match.group(1)
        text = text.strip()
        return json.loads(text)

    def _pass1_factual_extraction(self, timeline_text: str, screenshot_map: dict) -> dict:
        client = get_client()

        metadata_json = json.dumps(self._metadata, indent=2)
        user_content = []

        for event_index, screenshot_file in screenshot_map.items():
            try:
                b64 = self._load_screenshot(screenshot_file)
                label = f"Screenshot from click event index {event_index}: {screenshot_file}"
                user_content.append({"type": "text", "text": label})
                user_content.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
                })
            except Exception:
                pass

        user_content.append({
            "type": "text",
            "text": FACTUAL_EXTRACTION_PROMPT.format(
                timeline_json=timeline_text,
                metadata_json=metadata_json,
            ),
        })

        with client.messages.stream(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_FACTUAL,
            messages=[{"role": "user", "content": user_content}],
            thinking={"type": "adaptive"},
        ) as stream:
            message = stream.get_final_message()

        text = next(
            (b.text for b in message.content if hasattr(b, "text")),
            ""
        )
        return self._extract_json(text)

    def _pass2_recommendations(self, factual_results: dict) -> dict:
        client = get_client()

        visitor_name = self._metadata.get("visitor_name", "the visitor")
        se_name = self._metadata.get("se_name", "the SE")

        prompt = RECOMMENDATIONS_PROMPT.format(
            factual_json=json.dumps(factual_results, indent=2),
            visitor_name=visitor_name,
            se_name=se_name,
        )

        with client.messages.stream(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_RECOMMENDATIONS,
            messages=[{"role": "user", "content": prompt}],
            thinking={"type": "adaptive"},
        ) as stream:
            message = stream.get_final_message()

        text = next(
            (b.text for b in message.content if hasattr(b, "text")),
            ""
        )
        return self._extract_json(text)

    def _build_summary_json(self, factual: dict, recommendations: dict) -> dict:
        session_id = self._metadata.get("session_id", "unknown")
        visitor_name = self._metadata.get("visitor_name", "Unknown Visitor")

        started = self._metadata.get("started_at", "")
        ended = self._metadata.get("ended_at", "")
        duration_minutes = 0
        if started and ended:
            try:
                fmt = "%Y-%m-%dT%H:%M:%SZ"
                delta = datetime.strptime(ended, fmt) - datetime.strptime(started, fmt)
                duration_minutes = round(delta.total_seconds() / 60)
            except ValueError:
                duration_minutes = factual.get("session_stats", {}).get("duration_seconds", 0) // 60

        tenant_url = self._tenant.get("tenant_url", "")

        return {
            "session_id": session_id,
            "visitor_name": visitor_name,
            "demo_duration_minutes": duration_minutes,
            "session_score": recommendations.get("session_score", 0),
            "executive_summary": recommendations.get("executive_summary", ""),
            "products_shown": factual.get("products_shown", []),
            "visitor_interests": recommendations.get("visitor_interests", []),
            "recommended_follow_up": recommendations.get("recommended_follow_up", []),
            "key_moments": [
                {
                    "timestamp": m.get("timestamp_rel", ""),
                    "screenshot": m.get("screenshot_file", ""),
                    "description": m.get("description", ""),
                    "impact": m.get("impact", ""),
                }
                for m in factual.get("key_moments", [])[:3]
            ],
            "v1_tenant_link": tenant_url,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    def _build_follow_up_json(self, recommendations: dict) -> dict:
        session_id = self._metadata.get("session_id", "unknown")
        visitor_email = self._metadata.get("visitor_email", "")
        tenant_url = self._tenant.get("tenant_url", "")

        interests = recommendations.get("visitor_interests", [])
        tags = list({
            i["topic"].lower().split()[0]
            for i in interests
            if i.get("confidence") in ("high", "medium")
        })[:5]

        high_confidence = any(i.get("confidence") == "high" for i in interests)
        priority = "high" if high_confidence else "medium"

        return {
            "session_id": session_id,
            "visitor_email": visitor_email,
            "subject": "Your Vision One Demo Summary",
            "summary_url": f"https://boothapp.trendmicro.com/sessions/{session_id}/summary.html",
            "tenant_url": tenant_url,
            "priority": priority,
            "tags": tags,
            "sdr_notes": recommendations.get("sdr_notes", ""),
        }
