"""
Bedrock-based transcript analysis with error handling and fallback.

Calls Claude via Amazon Bedrock to analyze booth conversation transcripts.
If Bedrock fails after retries, returns a fallback message so the pipeline
can continue with degraded (but non-broken) output.
"""

import json
import logging
import os
import time

logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0"
DEFAULT_MAX_RETRIES = 2
DEFAULT_BASE_DELAY = 1.0
DEFAULT_MAX_TOKENS = 2048

FALLBACK_ANALYSIS = {
    "summary": "Analysis unavailable — Bedrock request failed after retries.",
    "insights": [],
    "topics": [],
    "engagement": "unknown",
    "error": True,
}

TRANSIENT_ERROR_CODES = {
    "ThrottlingException",
    "TooManyRequestsException",
    "ServiceUnavailableException",
    "InternalServerException",
    "ModelTimeoutException",
    "ModelNotReadyException",
}


def _is_retryable(exc):
    """Check if a Bedrock error is transient and worth retrying."""
    code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
    if code in TRANSIENT_ERROR_CODES:
        return True
    status = getattr(exc, "response", {}).get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
    return status in (429, 503)


def analyze_transcript(
    bedrock_client,
    transcript,
    model_id=None,
    max_retries=None,
    base_delay=None,
):
    """
    Analyze a transcript using Bedrock (Claude).

    Returns a dict with analysis results, or a fallback dict if all
    attempts fail.

    Args:
        bedrock_client: boto3 bedrock-runtime client
        transcript: str, the conversation transcript text
        model_id: Bedrock model ID (default from env or constant)
        max_retries: number of retry attempts (default 2)
        base_delay: base delay in seconds for exponential backoff (default 1.0)

    Returns:
        dict with analysis results or fallback message
    """
    model_id = model_id or os.environ.get("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)
    max_retries = max_retries if max_retries is not None else DEFAULT_MAX_RETRIES
    base_delay = base_delay if base_delay is not None else DEFAULT_BASE_DELAY

    payload = json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": DEFAULT_MAX_TOKENS,
        "messages": [
            {
                "role": "user",
                "content": (
                    "Analyze this booth conversation transcript and provide "
                    "key insights, topics discussed, and engagement level:\n\n"
                    f"{transcript}"
                ),
            }
        ],
    })

    last_error = None
    for attempt in range(max_retries + 1):
        try:
            response = bedrock_client.invoke_model(
                modelId=model_id,
                contentType="application/json",
                body=payload,
            )
            body = json.loads(response["body"].read())

            # Extract text from Claude's response
            text = ""
            if "content" in body and isinstance(body["content"], list):
                text = " ".join(
                    block.get("text", "") for block in body["content"]
                    if block.get("type") == "text"
                )

            return {
                "summary": text or body.get("completion", ""),
                "raw": body,
                "error": False,
            }

        except Exception as exc:
            last_error = exc
            logger.warning(
                "Bedrock attempt %d/%d failed: %s",
                attempt + 1,
                max_retries + 1,
                exc,
            )

            if not _is_retryable(exc) or attempt >= max_retries:
                break

            delay = base_delay * (2 ** attempt)
            logger.info("Retrying in %.1fs...", delay)
            time.sleep(delay)

    # All retries exhausted or non-retryable error
    logger.error("Bedrock analysis failed after %d attempts: %s", max_retries + 1, last_error)
    fallback = dict(FALLBACK_ANALYSIS)
    fallback["error_detail"] = str(last_error) if last_error else "unknown"
    return fallback


if __name__ == "__main__":
    import boto3

    client = boto3.client(
        "bedrock-runtime",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )
    sample = "Hello, I'd like to learn about your XDR solution."
    result = analyze_transcript(client, sample)
    print(json.dumps(result, indent=2))
