/**
 * Shared AWS environment configuration — single source of truth (JS mirror).
 *
 * Mirrors infra/config.py. If you change a value here, change it there too.
 * Chrome extension and any Node.js scripts import from this file.
 *
 * Usage (Chrome extension / Node.js):
 *   const { SESSION_BUCKET, AWS_REGION } = require('../infra/config');
 *   import { SESSION_BUCKET, AWS_REGION } from '../infra/config.js';
 */

// ── Core AWS ──────────────────────────────────────────────────────────────────

const AWS_PROFILE = "hackathon";
const AWS_REGION = "us-east-1";
const AWS_ACCOUNT_ID = "752266476357";

// ── S3 Buckets ────────────────────────────────────────────────────────────────

const SESSION_BUCKET = "boothapp-sessions-752266476357";  // Demo session data (per DATA-CONTRACT.md)
const SHARED_ENV_BUCKET = "boothapp-shared-env";  // Sample files/logs for demo scenarios

// ── IAM Role ARNs ─────────────────────────────────────────────────────────────

const IAM_ROLE_EXTENSION = `arn:aws:iam::${AWS_ACCOUNT_ID}:role/boothapp-extension-role`;
const IAM_ROLE_AUDIO     = `arn:aws:iam::${AWS_ACCOUNT_ID}:role/boothapp-audio-role`;
const IAM_ROLE_ANALYSIS  = `arn:aws:iam::${AWS_ACCOUNT_ID}:role/boothapp-analysis-role`;
const IAM_ROLE_INFRA     = `arn:aws:iam::${AWS_ACCOUNT_ID}:role/boothapp-infra-role`;

// ── Lambda Function Names ─────────────────────────────────────────────────────

const LAMBDA_SESSION_WATCHER   = "boothapp-session-watcher";
const LAMBDA_ANALYSIS_TRIGGER  = "boothapp-analysis-trigger";
const LAMBDA_TENANT_PROVISIONER = "boothapp-tenant-provisioner";

// ── CloudFormation Stack Names ────────────────────────────────────────────────

const STACK_S3          = "boothapp-s3";
const STACK_IAM         = "boothapp-iam";
const STACK_VPC         = "boothapp-shared-vpc";
const STACK_EC2         = "boothapp-shared-ec2";
const STACK_EKS         = "boothapp-shared-eks";
const STACK_TENANT_POOL = "boothapp-tenant-pool";

// ── Shared Demo Environment ───────────────────────────────────────────────────

const EC2_WINDOWS_NAME = "boothapp-demo-windows";  // Windows Server with Trend agent
const EC2_LINUX_NAME   = "boothapp-demo-linux";    // Linux with Trend agent
const EKS_CLUSTER_NAME = "boothapp-demo-cluster";  // EKS for Container Security demos

// ── S3 Key Helpers (mirrors DATA-CONTRACT.md) ─────────────────────────────────

/** @param {string} sessionId @param {...string} parts */
function sessionKey(sessionId, ...parts) {
  return ["sessions", sessionId, ...parts].join("/");
}

// ── Exports ───────────────────────────────────────────────────────────────────

if (typeof module !== "undefined") {
  module.exports = {
    AWS_PROFILE, AWS_REGION, AWS_ACCOUNT_ID,
    SESSION_BUCKET, SHARED_ENV_BUCKET,
    IAM_ROLE_EXTENSION, IAM_ROLE_AUDIO, IAM_ROLE_ANALYSIS, IAM_ROLE_INFRA,
    LAMBDA_SESSION_WATCHER, LAMBDA_ANALYSIS_TRIGGER, LAMBDA_TENANT_PROVISIONER,
    STACK_S3, STACK_IAM, STACK_VPC, STACK_EC2, STACK_EKS, STACK_TENANT_POOL,
    EC2_WINDOWS_NAME, EC2_LINUX_NAME, EKS_CLUSTER_NAME,
    sessionKey,
  };
}
