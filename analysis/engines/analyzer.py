import json
import os
import sys
import base64
import re
import time
import logging
from datetime import datetime, timezone

from .claude_client import get_client
from .prompts import (
    SYSTEM_FACTUAL,
    SYSTEM_RECOMMENDATIONS,
    FACTUAL_EXTRACTION_PROMPT,
    RECOMMENDATIONS_PROMPT,
    render_html_report,
)
from .email_template import render_follow_up_email
from .validator import validate_summary_or_raise

def _default_model():
    """Return the default model ID, accounting for Bedrock vs direct API."""
    if os.environ.get("USE_BEDROCK", "").strip() in ("1", "true", "yes"):
        return "us.anthropic.claude-sonnet-4-6"
    return "claude-sonnet-4-6"

MODEL = os.environ.get("ANALYSIS_MODEL") or _default_model()
MAX_TOKENS = 4096
MAX_SCREENSHOTS = 10

API_MAX_RETRIES = 3
API_BASE_DELAY_S = 5

logger = logging.getLogger(__name__)


def _is_retryable_api_error(err):
    """Check if an API/Bedrock error is transient and worth retrying."""
    import anthropic
    if isinstance(err, anthropic.RateLimitError):
        return True
    if isinstance(err, anthropic.APIStatusError) and err.status_code in (429, 500, 502, 503, 529):
        return True
    if isinstance(err, anthropic.APIConnectionError):
        return True
    if isinstance(err, anthropic.APITimeoutError):
        return True
    # Bedrock-specific errors from botocore (wrapped by AnthropicBedrock)
    err_name = getattr(err, "name", "") or type(err).__name__
    if err_name in (
        "ThrottlingException",
        "ServiceUnavailableException",
        "ModelTimeoutException",
        "ModelErrorException",
        "InternalServerException",
    ):
        return True
    err_str = str(err).lower()
    if "throttling" in err_str or "too many requests" in err_str or "service unavailable" in err_str:
        return True
    if "model timeout" in err_str or "internal server" in err_str:
        return True
    return False


def _call_with_retry(label, fn):
    """Call fn() with exponential backoff on retryable API errors."""
    for attempt in range(1, API_MAX_RETRIES + 1):
        try:
            return fn()
        except Exception as err:
            if attempt == API_MAX_RETRIES or not _is_retryable_api_error(err):
                raise
            delay = API_BASE_DELAY_S * (2 ** (attempt - 1))
            logger.warning(
                "%s: attempt %d/%d failed (%s), retrying in %ds...",
                label, attempt, API_MAX_RETRIES, err, delay,
            )
            time.sleep(delay)


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
        timeline_text, screenshot_map = self._load_correlator_timeline()

        try:
            factual = self._pass1_factual_extraction(timeline_text, screenshot_map)
        except Exception as e:
            logger.error("Bedrock/LLM error in factual pass: %s", e)
            return self._build_fallback_result(str(e))

        try:
            recommendations = self._pass2_recommendations(factual)
        except Exception as e:
            logger.error("Bedrock/LLM error in recommendations pass: %s", e)
            return self._build_fallback_result(str(e))

        summary = self._build_summary_json(factual, recommendations)
        validate_summary_or_raise(summary)
        follow_up = self._build_follow_up_json(recommendations)
        html = render_html_report(summary, follow_up, factual)
        email_html = render_follow_up_email(summary, follow_up, self._metadata)
        return {
            "summary": summary,
            "follow_up": follow_up,
            "html": html,
            "email_html": email_html,
        }

    def _build_fallback_result(self, error_msg: str) -> dict:
        session_id = self._metadata.get("session_id", "unknown")
        visitor_name = self._metadata.get("visitor_name", "Unknown Visitor")
        summary = {
            "session_id": session_id,
            "visitor_name": visitor_name,
            "demo_duration_seconds": 0,
            "session_score": 0,
            "executive_summary": f"AI analysis unavailable: {error_msg}",
            "products_demonstrated": [],
            "key_interests": [],
            "follow_up_actions": ["Review session recording manually"],
            "key_moments": [],
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "fallback": True,
            "fallback_reason": error_msg,
        }
        follow_up = {
            "session_id": session_id,
            "visitor_email": self._metadata.get("visitor_email", ""),
            "priority": "medium",
            "tags": ["fallback"],
            "sdr_notes": f"AI analysis failed: {error_msg}. Please review session manually.",
        }
        return {"summary": summary, "follow_up": follow_up, "html": ""}

    def _get_s3_client(self):
        if self._s3_client is None:
            import boto3
            import botocore.exceptions
            region = os.environ.get("AWS_REGION", "us-east-1")
            # Try explicit env creds -> AWS_PROFILE -> default chain (instance metadata)
            if os.environ.get("AWS_ACCESS_KEY_ID") and os.environ.get("AWS_SECRET_ACCESS_KEY"):
                session = boto3.Session(
                    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
                    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
                    aws_session_token=os.environ.get("AWS_SESSION_TOKEN"),
                    region_name=region,
                )
                self._s3_client = session.client("s3")
            elif os.environ.get("AWS_PROFILE"):
                session = boto3.Session(
                    profile_name=os.environ["AWS_PROFILE"],
                    region_name=region,
                )
                self._s3_client = session.client("s3")
            else:
                self._s3_client = boto3.client("s3", region_name=region)
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

    @staticmethod
    def _normalize_clicks(data):
        """Normalize clicks: accepts {events:[...]}, {clicks:[...]}, or top-level array."""
        if not data:
            return []
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            if isinstance(data.get("events"), list):
                return data["events"]
            if isinstance(data.get("clicks"), list):
                return data["clicks"]
        return []

    @staticmethod
    def _normalize_transcript_entries(data):
        """Normalize transcript: accepts {entries:[...]}, {results:[...]}, {items:[...]}, {transcripts:[...]}, or top-level array."""
        if not data:
            return []
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("entries", "results", "items", "transcripts"):
                if isinstance(data.get(key), list):
                    return data[key]
        return []

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

        # Normalize into standard lists for downstream use
        self._clicks_list = self._normalize_clicks(self._clicks)
        self._transcript_entries = self._normalize_transcript_entries(self._transcript)

        if not self._transcript_entries and not self._clicks_list:
            raise ValueError("No transcript and no clicks found — cannot analyze session")

    def _load_correlator_timeline(self) -> tuple:
        """Try loading the correlator's timeline.json, fall back to building our own."""
        try:
            timeline_data = self._read_json("output/timeline.json")
            events = timeline_data.get("timeline", [])
            if events:
                logger.info("Using correlator timeline.json (%d events)", len(events))
                return self._format_correlator_timeline(timeline_data)
        except Exception:
            pass
        logger.info("No correlator timeline found, building from raw inputs")
        return self._build_timeline_context()

    def _format_correlator_timeline(self, timeline_data: dict) -> tuple:
        """Convert correlator timeline.json into text + screenshot_map for the LLM."""
        lines = []
        screenshot_map = {}
        click_indices = []

        for i, event in enumerate(timeline_data.get("timeline", [])):
            etype = event.get("type", "")
            if etype == "speech":
                speaker = event.get("speaker", "")
                text = event.get("description", event.get("text", ""))
                # Strip "Speaker: " prefix if description has it
                if text.startswith(f"{speaker}: "):
                    text = text[len(f"{speaker}: "):]
                ts_offset = event.get("timestamp_offset", "")
                lines.append(f"[{ts_offset}] {speaker}: {text}")
            elif etype == "click":
                desc = event.get("description", "")
                page = event.get("page_title", "")
                screenshot = event.get("screenshot")
                if screenshot:
                    click_indices.append(i)
                    screenshot_map[i] = screenshot
                    lines.append(f"{desc} -- {page} [SCREENSHOT]")
                else:
                    lines.append(f"{desc} -- {page}")

        # Include detected topics as context for the LLM
        topics = timeline_data.get("topics_detected", [])
        if topics:
            lines.append("")
            lines.append("=== Product Topics Detected ===")
            for t in topics:
                lines.append(f"  {t['topic']}: {t['mentions']} mentions (first at {t.get('first_seen_offset', 0):.0f}s)")

        engagement = timeline_data.get("engagement_score")
        if engagement is not None:
            lines.append(f"Engagement score: {engagement}/10")

        return "\n".join(lines), screenshot_map

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

        for entry in self._transcript_entries:
            events.append({
                "type": "transcript",
                "timestamp": entry.get("timestamp", "00:00:00"),
                "seconds": self._timestamp_to_seconds(entry.get("timestamp", "00:00:00")),
                "speaker": entry.get("speaker", ""),
                "text": entry.get("text", ""),
            })

        for click in self._clicks_list:
            events.append({
                "type": "click",
                "timestamp": click.get("timestamp", ""),
                "seconds": 0,
                "index": click.get("index", 0),
                "element_text": click.get("element", {}).get("text", "") if isinstance(click.get("element"), dict) else (click.get("element") or ""),
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
        """Extract JSON from LLM response that may contain markdown fences or extra text."""
        logger.debug("Raw LLM response (first 200 chars): %.200s", text)

        # 1. Try stripping markdown code fences
        fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fence_match:
            try:
                return json.loads(fence_match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # 2. Try parsing the full text as-is
        stripped = text.strip()
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass

        # 3. Find the outermost { ... } block
        brace_match = re.search(r"\{[\s\S]*\}", stripped)
        if brace_match:
            try:
                return json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                pass

        raise json.JSONDecodeError(
            f"No valid JSON found in LLM response (first 200 chars): {text[:200]}",
            text, 0,
        )

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

        def _do_pass1():
            with client.messages.stream(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_FACTUAL,
                messages=[{"role": "user", "content": user_content}],
                thinking={"type": "adaptive"},
            ) as stream:
                return stream.get_final_message()

        message = _call_with_retry("pass1_factual", _do_pass1)

        text = next(
            (b.text for b in message.content if hasattr(b, "text")),
            ""
        )
        try:
            return self._extract_json(text)
        except json.JSONDecodeError:
            logger.warning("pass1: JSON extraction failed, retrying with explicit JSON instruction")
            return self._retry_json_only(client, SYSTEM_FACTUAL, user_content)

    def _retry_json_only(self, client, system: str, user_content) -> dict:
        """Retry a failed pass with an explicit 'respond with only JSON' instruction."""
        if isinstance(user_content, str):
            retry_content = user_content + "\n\nIMPORTANT: Respond with ONLY a valid JSON object. No markdown, no explanation, no code fences. Just the raw JSON."
        else:
            retry_content = list(user_content) + [{
                "type": "text",
                "text": "\n\nIMPORTANT: Respond with ONLY a valid JSON object. No markdown, no explanation, no code fences. Just the raw JSON.",
            }]

        def _do_retry():
            with client.messages.stream(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=[{"role": "user", "content": retry_content}],
                thinking={"type": "adaptive"},
            ) as stream:
                return stream.get_final_message()

        message = _call_with_retry("retry_json_only", _do_retry)
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

        def _do_pass2():
            with client.messages.stream(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_RECOMMENDATIONS,
                messages=[{"role": "user", "content": prompt}],
                thinking={"type": "adaptive"},
            ) as stream:
                return stream.get_final_message()

        message = _call_with_retry("pass2_recommendations", _do_pass2)

        text = next(
            (b.text for b in message.content if hasattr(b, "text")),
            ""
        )
        try:
            return self._extract_json(text)
        except json.JSONDecodeError:
            logger.warning("pass2: JSON extraction failed, retrying with explicit JSON instruction")
            return self._retry_json_only(client, SYSTEM_RECOMMENDATIONS, prompt)

    def _build_summary_json(self, factual: dict, recommendations: dict) -> dict:
        session_id = self._metadata.get("session_id", "unknown")
        visitor_name = self._metadata.get("visitor_name", "Unknown Visitor")

        started = self._metadata.get("started_at", "")
        ended = self._metadata.get("ended_at", "")
        duration_seconds = 0
        if started and ended:
            try:
                fmt = "%Y-%m-%dT%H:%M:%SZ"
                delta = datetime.strptime(ended, fmt) - datetime.strptime(started, fmt)
                duration_seconds = round(delta.total_seconds())
            except ValueError:
                duration_seconds = factual.get("session_stats", {}).get("duration_seconds", 0)

        tenant_url = self._tenant.get("tenant_url", "")

        return {
            "session_id": session_id,
            "visitor_name": visitor_name,
            "products_demonstrated": factual.get("products_demonstrated", factual.get("products_shown", [])),
            "key_interests": recommendations.get("key_interests", recommendations.get("visitor_interests", [])),
            "follow_up_actions": recommendations.get("follow_up_actions", recommendations.get("recommended_follow_up", [])),
            "demo_duration_seconds": duration_seconds,
            "session_score": recommendations.get("session_score", 0),
            "executive_summary": recommendations.get("executive_summary", ""),
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

        interests = recommendations.get("key_interests", recommendations.get("visitor_interests", []))
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
