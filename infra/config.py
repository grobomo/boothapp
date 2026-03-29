"""
Shared AWS environment configuration — single source of truth.

All workstreams import from here. Never hardcode bucket names, ARNs,
region, or resource identifiers elsewhere in the codebase.

Usage (Python):
    from infra.config import SESSION_BUCKET, AWS_REGION

Usage (generate JSON for JS consumers):
    python infra/config.py > infra/config.json
"""

import json
import sys

# ── Core AWS ──────────────────────────────────────────────────────────────────

AWS_PROFILE = "hackathon"
AWS_REGION = "us-east-1"
AWS_ACCOUNT_ID = "752266476357"

# ── S3 Buckets ────────────────────────────────────────────────────────────────

SESSION_BUCKET = "boothapp-sessions-752266476357"  # Demo session data (per DATA-CONTRACT.md)
SHARED_ENV_BUCKET = "boothapp-shared-env"     # Sample files/logs for demo scenarios

# ── IAM Role ARNs ─────────────────────────────────────────────────────────────

IAM_ROLE_EXTENSION = f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/boothapp-extension-role"
IAM_ROLE_AUDIO = f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/boothapp-audio-role"
IAM_ROLE_ANALYSIS = f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/boothapp-analysis-role"
IAM_ROLE_INFRA = f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/boothapp-infra-role"

# ── Lambda Function Names ─────────────────────────────────────────────────────

LAMBDA_SESSION_WATCHER = "boothapp-session-watcher"
LAMBDA_ANALYSIS_TRIGGER = "boothapp-analysis-trigger"
LAMBDA_TENANT_PROVISIONER = "boothapp-tenant-provisioner"

# ── CloudFormation Stack Names ────────────────────────────────────────────────

STACK_S3 = "boothapp-s3"
STACK_IAM = "boothapp-iam"
STACK_VPC = "boothapp-shared-vpc"
STACK_EC2 = "boothapp-shared-ec2"
STACK_EKS = "boothapp-shared-eks"
STACK_TENANT_POOL = "boothapp-tenant-pool"

# ── Shared Demo Environment ───────────────────────────────────────────────────

EC2_WINDOWS_NAME = "boothapp-demo-windows"     # Windows Server with Trend agent
EC2_LINUX_NAME = "boothapp-demo-linux"         # Linux with Trend agent
EKS_CLUSTER_NAME = "boothapp-demo-cluster"     # EKS for Container Security demos

# ── S3 Key Helpers (mirrors DATA-CONTRACT.md) ─────────────────────────────────

def session_prefix(session_id: str) -> str:
    return f"sessions/{session_id}"

def session_key(session_id: str, *parts: str) -> str:
    """Build an S3 key under a session folder.

    Examples:
        session_key("A726594", "metadata.json")       -> "sessions/A726594/metadata.json"
        session_key("A726594", "clicks", "clicks.json") -> "sessions/A726594/clicks/clicks.json"
    """
    return "/".join(["sessions", session_id, *parts])

# ── JSON export (for JS/non-Python consumers) ─────────────────────────────────

def _as_dict() -> dict:
    """Return all scalar config values as a plain dict."""
    return {
        "AWS_PROFILE": AWS_PROFILE,
        "AWS_REGION": AWS_REGION,
        "AWS_ACCOUNT_ID": AWS_ACCOUNT_ID,
        "SESSION_BUCKET": SESSION_BUCKET,
        "SHARED_ENV_BUCKET": SHARED_ENV_BUCKET,
        "IAM_ROLE_EXTENSION": IAM_ROLE_EXTENSION,
        "IAM_ROLE_AUDIO": IAM_ROLE_AUDIO,
        "IAM_ROLE_ANALYSIS": IAM_ROLE_ANALYSIS,
        "IAM_ROLE_INFRA": IAM_ROLE_INFRA,
        "LAMBDA_SESSION_WATCHER": LAMBDA_SESSION_WATCHER,
        "LAMBDA_ANALYSIS_TRIGGER": LAMBDA_ANALYSIS_TRIGGER,
        "LAMBDA_TENANT_PROVISIONER": LAMBDA_TENANT_PROVISIONER,
        "STACK_S3": STACK_S3,
        "STACK_IAM": STACK_IAM,
        "STACK_VPC": STACK_VPC,
        "STACK_EC2": STACK_EC2,
        "STACK_EKS": STACK_EKS,
        "STACK_TENANT_POOL": STACK_TENANT_POOL,
        "EC2_WINDOWS_NAME": EC2_WINDOWS_NAME,
        "EC2_LINUX_NAME": EC2_LINUX_NAME,
        "EKS_CLUSTER_NAME": EKS_CLUSTER_NAME,
    }


if __name__ == "__main__":
    # python infra/config.py  →  prints JSON, pipe to infra/config.json
    json.dump(_as_dict(), sys.stdout, indent=2)
    sys.stdout.write("\n")
