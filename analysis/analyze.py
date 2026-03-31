"""
Bedrock analysis module -- invokes Claude via AWS Bedrock with error handling.

If the Bedrock call fails after retries, returns a structured fallback response
so downstream consumers always get valid JSON.
"""

import json
import time
import sys

import boto3
from botocore.exceptions import ClientError, EndpointConnectionError

BEDROCK_REGION = "us-east-1"
MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0"
MAX_RETRIES = 2
BASE_DELAY_S = 2

FALLBACK_RESPONSE = {
    "analysis": None,
    "error": True,
    "message": "Analysis unavailable -- Bedrock request failed after retries. "
               "The recording was saved successfully and can be re-analyzed later.",
    "suggestions": [
        "Check AWS Bedrock service health in the console.",
        "Verify the model ID is correct and available in your region.",
        "Retry the analysis manually from the dashboard.",
    ],
}

RETRYABLE_ERROR_CODES = {
    "ThrottlingException",
    "TooManyRequestsException",
    "ServiceUnavailableException",
    "InternalServerException",
    "ModelNotReadyException",
    "ModelTimeoutException",
}


def invoke_bedrock(transcript, model_id=None, region=None):
    """
    Send a transcript to Bedrock for analysis.

    Returns the parsed response on success, or the FALLBACK_RESPONSE if all
    retries are exhausted.
    """
    client = boto3.client(
        "bedrock-runtime",
        region_name=region or BEDROCK_REGION,
    )
    model = model_id or MODEL_ID

    payload = json.dumps({
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
    })

    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = client.invoke_model(
                modelId=model,
                contentType="application/json",
                body=payload,
            )
            body = json.loads(resp["body"].read())
            return body

        except ClientError as exc:
            error_code = exc.response["Error"]["Code"]
            last_error = exc

            if error_code not in RETRYABLE_ERROR_CODES:
                print(
                    f"[analyze] Non-retryable Bedrock error: {error_code} "
                    f"-- {exc}",
                    file=sys.stderr,
                )
                return {**FALLBACK_RESPONSE, "code": error_code, "detail": str(exc)}

            if attempt < MAX_RETRIES:
                delay = BASE_DELAY_S * (2 ** attempt)
                print(
                    f"[analyze] Retryable error {error_code}, attempt "
                    f"{attempt + 1}/{MAX_RETRIES}, waiting {delay}s",
                    file=sys.stderr,
                )
                time.sleep(delay)

        except EndpointConnectionError as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                delay = BASE_DELAY_S * (2 ** attempt)
                print(
                    f"[analyze] Connection error, attempt {attempt + 1}/"
                    f"{MAX_RETRIES}, waiting {delay}s",
                    file=sys.stderr,
                )
                time.sleep(delay)

        except Exception as exc:
            print(f"[analyze] Unexpected error: {exc}", file=sys.stderr)
            return {**FALLBACK_RESPONSE, "detail": str(exc)}

    print(
        f"[analyze] All {MAX_RETRIES} retries exhausted. Last error: "
        f"{last_error}",
        file=sys.stderr,
    )
    return {**FALLBACK_RESPONSE, "detail": str(last_error)}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python analyze.py <transcript-file>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1]) as f:
        text = f.read()

    result = invoke_bedrock(text)
    print(json.dumps(result, indent=2))
