"""
Analyze transcript using Amazon Bedrock (Claude).

Handles Bedrock errors gracefully with a fallback message when Claude
is unavailable or returns an error.
"""

import json
import os
import sys

FALLBACK_MESSAGE = (
    "Analysis unavailable. The AI service encountered an error and could not "
    "process this transcript. Please retry later or review the transcript manually."
)

BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0"
)
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


def build_client():
    """Build a Bedrock Runtime client."""
    import boto3

    return boto3.client("bedrock-runtime", region_name=AWS_REGION)


def analyze_transcript(transcript, client=None, model_id=None):
    """
    Analyze a booth conversation transcript using Bedrock Claude.

    Returns a dict with analysis results. On Bedrock failure, returns a
    fallback response instead of raising.

    Args:
        transcript: The transcript text to analyze.
        client: Optional pre-built bedrock-runtime client.
        model_id: Optional model ID override.

    Returns:
        dict with keys: success, analysis|fallback_message, error (if failed)
    """
    if client is None:
        try:
            client = build_client()
        except Exception as exc:
            return {
                "success": False,
                "fallback_message": FALLBACK_MESSAGE,
                "error": f"Failed to initialize Bedrock client: {exc}",
            }

    mid = model_id or BEDROCK_MODEL_ID
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2048,
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "Analyze this booth conversation transcript and provide "
                        "key insights:\n\n" + transcript
                    ),
                }
            ],
        }
    )

    try:
        response = client.invoke_model(
            modelId=mid,
            contentType="application/json",
            body=body,
        )
        result = json.loads(response["body"].read())
        return {"success": True, "analysis": result}

    except client.exceptions.ThrottlingException as exc:
        return {
            "success": False,
            "fallback_message": FALLBACK_MESSAGE,
            "error": f"Bedrock throttled: {exc}",
            "retryable": True,
        }

    except client.exceptions.ModelTimeoutException as exc:
        return {
            "success": False,
            "fallback_message": FALLBACK_MESSAGE,
            "error": f"Bedrock model timeout: {exc}",
            "retryable": True,
        }

    except client.exceptions.ValidationException as exc:
        return {
            "success": False,
            "fallback_message": FALLBACK_MESSAGE,
            "error": f"Bedrock validation error: {exc}",
            "retryable": False,
        }

    except Exception as exc:
        return {
            "success": False,
            "fallback_message": FALLBACK_MESSAGE,
            "error": f"Bedrock call failed: {exc}",
            "retryable": False,
        }


def main():
    """CLI entry point: reads transcript from stdin or file argument."""
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r") as f:
            transcript = f.read()
    else:
        transcript = sys.stdin.read()

    if not transcript.strip():
        print(json.dumps({"success": False, "error": "Empty transcript"}))
        sys.exit(1)

    result = analyze_transcript(transcript)
    print(json.dumps(result, indent=2))

    if not result["success"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
