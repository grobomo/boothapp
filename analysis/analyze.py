#!/usr/bin/env python3
import argparse
import json
import os
import sys

from engines.analyzer import SessionAnalyzer


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
    if output_dir.startswith("s3://"):
        import boto3
        prefix = output_dir.replace("s3://", "")
        bucket, _, key_prefix = prefix.partition("/")
        s3 = boto3.client("s3")
        for filename, data in [("summary.json", results["summary"]), ("follow-up.json", results["follow_up"])]:
            key = f"{key_prefix}/{filename}".lstrip("/")
            s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(data, indent=2), ContentType="application/json")
            print(f"  Wrote s3://{bucket}/{key}")
    else:
        os.makedirs(output_dir, exist_ok=True)
        for filename, data in [("summary.json", results["summary"]), ("follow-up.json", results["follow_up"])]:
            path = os.path.join(output_dir, filename)
            with open(path, "w") as f:
                json.dump(data, f, indent=2)
            print(f"  Wrote {path}")
        if results.get("html"):
            html_path = os.path.join(output_dir, "summary.html")
            with open(html_path, "w") as f:
                f.write(results["html"])
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
    print(f"\nSession: {summary.get('session_id')} — {summary.get('visitor_name')}")
    print(f"Duration: {summary.get('demo_duration_minutes')} minutes")
    products = summary.get("products_shown", [])
    print(f"Products shown: {', '.join(products) if products else 'none detected'}")
    interests = summary.get("visitor_interests", [])
    if interests:
        print(f"Top interests ({len(interests)}):")
        for i in interests[:3]:
            print(f"  [{i.get('confidence','?')}] {i.get('topic')}")
    follow_up = summary.get("recommended_follow_up", [])
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
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Analysis failed: {e}", file=sys.stderr)
        return 1

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
