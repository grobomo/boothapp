#!/usr/bin/env python3
import argparse
import json
import os
import sys

from engines.analyzer import SessionAnalyzer
from engines.competitive import analyze_transcript as analyze_competitive
from engines.email_template import render_follow_up_email
from engines.product_detector import detect_products


def _make_s3_client():
    """Create a boto3 S3 client with credential fallback.

    Tries env vars -> AWS_PROFILE -> default chain (instance metadata).
    """
    import boto3
    region = os.environ.get("AWS_REGION", "us-east-1")
    if os.environ.get("AWS_ACCESS_KEY_ID") and os.environ.get("AWS_SECRET_ACCESS_KEY"):
        session = boto3.Session(
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            aws_session_token=os.environ.get("AWS_SESSION_TOKEN"),
            region_name=region,
        )
        return session.client("s3")
    if os.environ.get("AWS_PROFILE"):
        session = boto3.Session(profile_name=os.environ["AWS_PROFILE"], region_name=region)
        return session.client("s3")
    return boto3.client("s3", region_name=region)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Analyze a booth demo session with Claude"
    )
    parser.add_argument("--session-dir", dest="session_dir_flag", default=None,
                        help="Local path or s3://bucket/sessions/SESSION_ID")
    parser.add_argument("session_dir", nargs="?", default=None,
                        help="Local path or s3://bucket/sessions/SESSION_ID")
    parser.add_argument(
        "output_dir",
        nargs="?",
        default=None,
        help="Where to write summary.json and follow-up.json (default: <session_dir>/output/)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run analysis but do not write output files",
    )
    parser.add_argument(
        "--competitive",
        action="store_true",
        help="Run competitive intelligence analysis on transcript",
    )
    args = parser.parse_args()
    # Support both positional and --session-dir flag
    args.session_dir = args.session_dir_flag or args.session_dir
    if not args.session_dir:
        parser.error("session_dir is required (positional or --session-dir)")
    return args


def resolve_output_dir(session_dir: str, output_dir: str) -> str:
    """Determine the output directory for analysis results.

    If an explicit output_dir is provided, it is returned as-is.
    Otherwise, an ``output/`` subdirectory under session_dir is used.
    Both local paths and s3:// URIs are supported.

    Args:
        session_dir: Local path or s3:// URI of the session to analyze.
        output_dir: Explicit output path, or None to auto-derive.

    Returns:
        Resolved output directory path (local or s3:// URI).
    """
    if output_dir:
        return output_dir
    if session_dir.startswith("s3://"):
        return session_dir.rstrip("/") + "/output"
    return os.path.join(session_dir, "output")


def write_output(output_dir: str, results: dict):
    """Write analysis results (summary.json, follow-up.json, summary.html) to disk or S3.

    For S3 destinations, uploads JSON files via boto3. For local paths, creates
    the output directory if needed and writes JSON files plus an optional HTML
    report when ``results["html"]`` is present.

    Args:
        output_dir: Local path or s3:// URI where output files are written.
        results: Dict with ``summary``, ``follow_up``, and optional ``html`` keys.
    """
    json_files = [("summary.json", results["summary"]), ("follow-up.json", results["follow_up"])]
    if results.get("products"):
        json_files.append(("products.json", results["products"]))
    if results.get("competitive_insights"):
        json_files.append(("competitive-insights.json", results["competitive_insights"]))

    html_files = []
    if results.get("html"):
        html_files.append(("summary.html", results["html"]))
    if results.get("follow_up_email_html"):
        html_files.append(("follow-up-email.html", results["follow_up_email_html"]))

    if output_dir.startswith("s3://"):
        prefix = output_dir.replace("s3://", "")
        bucket, _, key_prefix = prefix.partition("/")
        s3 = _make_s3_client()
        for filename, data in json_files:
            key = f"{key_prefix}/{filename}".lstrip("/")
            s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(data, indent=2), ContentType="application/json")
            print(f"  Wrote s3://{bucket}/{key}")
        for filename, content in html_files:
            key = f"{key_prefix}/{filename}".lstrip("/")
            s3.put_object(Bucket=bucket, Key=key, Body=content, ContentType="text/html")
            print(f"  Wrote s3://{bucket}/{key}")
    else:
        os.makedirs(output_dir, exist_ok=True)
        for filename, data in json_files:
            path = os.path.join(output_dir, filename)
            with open(path, "w") as f:
                json.dump(data, f, indent=2)
            print(f"  Wrote {path}")
        for filename, content in html_files:
            html_path = os.path.join(output_dir, filename)
            with open(html_path, "w") as f:
                f.write(content)
            print(f"  Wrote {html_path}")


def print_summary(results: dict):
    """Print a human-readable session summary to stdout.

    Displays session metadata (ID, visitor, duration), products shown,
    top visitor interests with confidence scores, and recommended
    follow-up actions with priority level.

    Args:
        results: Analysis results dict containing ``summary`` and ``follow_up`` keys.
    """
    summary = results["summary"]
    print(f"\nSession: {summary.get('session_id')} -- {summary.get('visitor_name')}")
    duration_s = summary.get("demo_duration_seconds", 0)
    print(f"Duration: {duration_s // 60}m {duration_s % 60}s ({duration_s}s)")
    products = summary.get("products_demonstrated", [])
    print(f"Products demonstrated: {', '.join(products) if products else 'none detected'}")
    interests = summary.get("key_interests", [])
    if interests:
        print(f"Key interests ({len(interests)}):")
        for i in interests[:3]:
            print(f"  [{i.get('confidence','?')}] {i.get('topic')}")
    follow_up = summary.get("follow_up_actions", [])
    if follow_up:
        print(f"Follow-up actions ({len(follow_up)}):")
        for action in follow_up[:3]:
            print(f"  - {action}")
    print(f"Follow-up priority: {results['follow_up'].get('priority', 'medium')}")


def main():
    args = parse_args()
    output_dir = resolve_output_dir(args.session_dir, args.output_dir)

    print(f"Analyzing session: {args.session_dir}")
    if args.dry_run:
        print("(dry run — outputs will not be written)")

    try:
        analyzer = SessionAnalyzer(args.session_dir)
        results = analyzer.analyze()
    except ValueError as e:
        print(f"Warning: {e} — generating fallback summary", file=sys.stderr)
        results = {
            "summary": {
                "session_id": "unknown",
                "visitor_name": "Unknown Visitor",
                "demo_duration_seconds": 0,
                "session_score": 0,
                "executive_summary": f"Analysis unavailable: {e}",
                "products_demonstrated": [],
                "key_interests": [],
                "follow_up_actions": ["Review session recording manually"],
                "key_moments": [],
                "generated_at": __import__("datetime").datetime.now(
                    __import__("datetime").timezone.utc
                ).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "fallback": True,
                "fallback_reason": str(e),
            },
            "follow_up": {
                "session_id": "unknown",
                "visitor_email": "",
                "priority": "medium",
                "tags": ["fallback"],
                "sdr_notes": f"Analysis unavailable: {e}. Please review session manually.",
            },
        }
    except Exception as e:
        print(f"Analysis failed: {e}", file=sys.stderr)
        return 1

    # Run product detection from clicks data (no LLM needed)
    try:
        clicks_data = {}
        if args.session_dir.startswith("s3://"):
            prefix = args.session_dir.replace("s3://", "")
            bucket, _, key_prefix = prefix.partition("/")
            s3 = _make_s3_client()
            resp = s3.get_object(Bucket=bucket, Key=f"{key_prefix}/clicks/clicks.json")
            clicks_data = json.loads(resp["Body"].read())
        else:
            clicks_path = os.path.join(args.session_dir, "clicks", "clicks.json")
            if os.path.exists(clicks_path):
                with open(clicks_path) as f:
                    clicks_data = json.load(f)
        if clicks_data:
            results["products"] = detect_products(clicks_data)
    except Exception as e:
        print(f"Warning: product detection failed: {e}", file=sys.stderr)

    # Generate follow-up email template from analysis results
    try:
        metadata = {}
        if not args.session_dir.startswith("s3://"):
            meta_path = os.path.join(args.session_dir, "metadata.json")
            if os.path.exists(meta_path):
                with open(meta_path) as f:
                    metadata = json.load(f)
        results["follow_up_email_html"] = render_follow_up_email(
            results["summary"], results["follow_up"], metadata
        )
    except Exception as e:
        print(f"Warning: follow-up email generation failed: {e}", file=sys.stderr)

    # Optional: competitive intelligence analysis on transcript
    if args.competitive:
        try:
            transcript_data = {}
            if args.session_dir.startswith("s3://"):
                prefix = args.session_dir.replace("s3://", "")
                bucket, _, key_prefix = prefix.partition("/")
                s3 = _make_s3_client()
                resp = s3.get_object(Bucket=bucket, Key=f"{key_prefix}/transcript/transcript.json")
                transcript_data = json.loads(resp["Body"].read())
            else:
                transcript_path = os.path.join(args.session_dir, "transcript", "transcript.json")
                if os.path.exists(transcript_path):
                    with open(transcript_path) as f:
                        transcript_data = json.load(f)
            if transcript_data:
                competitive = analyze_competitive(transcript_data)
                results["competitive_insights"] = competitive
                if competitive["total_mentions"] > 0:
                    print(f"\nCompetitive mentions detected: {competitive['total_mentions']}")
                    for s in competitive["competitor_summary"]:
                        print(f"  {s['competitor']}: {s['mention_count']} mention(s) -- {', '.join(s['concerns'])}")
        except Exception as e:
            print(f"Warning: competitive analysis failed: {e}", file=sys.stderr)

    print_summary(results)

    if not args.dry_run:
        print(f"\nWriting outputs to {output_dir}")
        try:
            write_output(output_dir, results)
        except Exception as e:
            print(f"Failed to write outputs: {e}", file=sys.stderr)
            return 1

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
