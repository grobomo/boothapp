"""
Session Data Integrity Checker

Validates raw session data before the analysis pipeline runs.
Hard failures reject the session; soft failures log warnings and continue.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class IntegrityError(Exception):
    """Raised when a hard validation failure rejects the session."""

    def __init__(self, failures: list[str]):
        self.failures = failures
        super().__init__(f"Session rejected: {'; '.join(failures)}")


class IntegrityResult:
    """Holds validation outcome -- warnings (soft) and failures (hard)."""

    __slots__ = ("warnings", "failures")

    def __init__(self) -> None:
        self.warnings: list[str] = []
        self.failures: list[str] = []

    @property
    def ok(self) -> bool:
        return len(self.failures) == 0

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        logger.warning("integrity: %s", msg)

    def fail(self, msg: str) -> None:
        self.failures.append(msg)
        logger.error("integrity: %s", msg)


def _check_click_timestamps(
    clicks: list[dict], session_start: int, session_end: int, result: IntegrityResult
) -> None:
    """Hard failure if any click timestamp falls outside the session window."""
    for i, click in enumerate(clicks):
        ts = click.get("timestamp")
        if ts is None:
            result.fail(f"Click [{i}] missing timestamp")
            continue
        if not isinstance(ts, (int, float)):
            result.fail(f"Click [{i}] timestamp is not a number: {ts!r}")
            continue
        if ts < session_start or ts > session_end:
            result.fail(
                f"Click [{i}] timestamp {ts} outside session range "
                f"[{session_start}, {session_end}]"
            )


def _check_transcript_entries(
    transcript: list[dict], result: IntegrityResult
) -> None:
    """Soft failure (warning) for transcript entries with empty text."""
    for i, entry in enumerate(transcript):
        text = entry.get("text", "")
        if not isinstance(text, str) or not text.strip():
            result.warn(f"Transcript [{i}] has empty text")


def _check_duplicate_clicks(
    clicks: list[dict], result: IntegrityResult
) -> list[dict]:
    """Soft failure for duplicate click events. Returns deduplicated list."""
    seen: set[tuple] = set()
    unique: list[dict] = []
    dup_count = 0
    for click in clicks:
        key = (
            click.get("timestamp"),
            click.get("url"),
            click.get("x"),
            click.get("y"),
        )
        if key in seen:
            dup_count += 1
            continue
        seen.add(key)
        unique.append(click)
    if dup_count:
        result.warn(f"{dup_count} duplicate click event(s) removed")
    return unique


def _check_visitor_name(metadata: dict, result: IntegrityResult) -> None:
    """Hard failure if visitor_name is empty or missing."""
    name = metadata.get("visitor_name", "")
    if not isinstance(name, str) or not name.strip():
        result.fail("Metadata visitor_name is empty or missing")


def validate_session(session: dict[str, Any]) -> tuple[IntegrityResult, dict[str, Any]]:
    """Validate session data integrity before analysis.

    Args:
        session: Raw session data with keys:
            - session_start (int): epoch ms
            - session_end (int): epoch ms
            - clicks (list[dict]): click events with timestamp, url, x, y
            - transcript (list[dict]): entries with text
            - metadata (dict): must include visitor_name

    Returns:
        Tuple of (IntegrityResult, cleaned_session).
        If result.ok is False, the session should be rejected.

    Raises:
        IntegrityError: When hard failures are found and raise_on_failure
            would be used by the caller.
    """
    result = IntegrityResult()

    clicks = session.get("clicks", [])
    transcript = session.get("transcript", [])
    metadata = session.get("metadata", {})
    session_start = session.get("session_start", 0)
    session_end = session.get("session_end", 0)

    # Hard checks
    _check_visitor_name(metadata, result)
    _check_click_timestamps(clicks, session_start, session_end, result)

    # Soft checks
    _check_transcript_entries(transcript, result)
    deduped_clicks = _check_duplicate_clicks(clicks, result)

    # Build cleaned session
    cleaned = dict(session)
    cleaned["clicks"] = deduped_clicks

    return result, cleaned


def validate_session_or_raise(session: dict[str, Any]) -> dict[str, Any]:
    """Validate and return cleaned session, raising on hard failures.

    Convenience wrapper that raises IntegrityError if validation fails.
    """
    result, cleaned = validate_session(session)
    if not result.ok:
        raise IntegrityError(result.failures)
    return cleaned
