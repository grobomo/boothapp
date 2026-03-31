// NIST CSF 2.0 Access Control Gate
// PR.AC-01: IAM least privilege (no hardcoded creds, no root)
//
// Blocks:
//   - Hardcoded AWS access key IDs (AKIA pattern)
//   - Use of root credentials or root account references
//   - Direct credential usage instead of IAM roles

"use strict";

var ACCESS_GATE_ID = "nist-access-gate";

/**
 * Check for hardcoded AWS access key IDs (AKIA pattern).
 * Returns a reason string if blocked, null if OK.
 */
function checkHardcodedKeys(content) {
  // AWS access key IDs start with AKIA and are 20 chars
  var akiaPattern = /\bAKIA[0-9A-Z]{16}\b/;

  if (akiaPattern.test(content)) {
    return "[PR.AC-01] Hardcoded AWS access key ID (AKIA*) detected. Use IAM roles, instance profiles, or environment variable references instead. Never embed credentials in code.";
  }

  // Also catch ASIA (temporary) keys being hardcoded
  var asiaPattern = /\bASIA[0-9A-Z]{16}\b/;
  if (asiaPattern.test(content)) {
    return "[PR.AC-01] Hardcoded AWS temporary access key (ASIA*) detected. Use IAM roles or STS assume-role with environment variables instead.";
  }

  return null;
}

/**
 * Check for root account usage.
 * Returns a reason string if blocked, null if OK.
 */
function checkRootUsage(content) {
  var rootPatterns = [
    // AWS root account usage
    { regex: /--profile\s+root\b/i, msg: "AWS root profile" },
    { regex: /\baws_root\b/i, msg: "AWS root reference" },
    { regex: /\broot-account-mfa\b/i, msg: "root account MFA token" },
    // Using account ID as credential source (often root)
    { regex: /arn:aws:iam::\d{12}:root\b/, msg: "IAM root ARN" },
  ];

  for (var i = 0; i < rootPatterns.length; i++) {
    if (rootPatterns[i].regex.test(content)) {
      return "[PR.AC-01] " + rootPatterns[i].msg + " usage detected. Use an IAM user or role with least-privilege permissions. Root credentials must never be used for operational tasks.";
    }
  }

  return null;
}

/**
 * Check for direct credential embedding instead of IAM role usage.
 * Returns a reason string if blocked, null if OK.
 */
function checkCredentialEmbedding(content) {
  var patterns = [
    // aws configure set with literal key values
    { regex: /aws\s+configure\s+set\s+aws_access_key_id\s+\S+/i, msg: "aws configure set with literal key" },
    { regex: /aws\s+configure\s+set\s+aws_secret_access_key\s+\S+/i, msg: "aws configure set with literal secret" },
    // Credential file writes with literal keys
    { regex: /\[default\]\s*\n\s*aws_access_key_id\s*=/m, msg: "credentials file with hardcoded keys" },
    // boto3/SDK credential constructor patterns
    { regex: /aws_access_key_id\s*=\s*["'][A-Z0-9]/i, msg: "SDK client with hardcoded access key" },
    { regex: /aws_secret_access_key\s*=\s*["'][A-Za-z0-9/+=]/i, msg: "SDK client with hardcoded secret key" },
  ];

  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].regex.test(content)) {
      return "[PR.AC-01] " + patterns[i].msg + " detected. Use IAM roles (EC2 instance profiles, ECS task roles, Lambda execution roles) or AWS SSO. Never embed credentials in code or config files.";
    }
  }

  return null;
}

/**
 * Main gate function. Receives the hook input object.
 * Returns { block: true, reason: "..." } or { block: false }.
 */
function gate(hookInput) {
  var toolName = hookInput.tool_name || "";
  var toolInput = hookInput.tool_input || {};

  // Check Bash commands, Write content, and Edit content
  var contentToCheck = "";

  if (toolName === "Bash" || toolName === "bash") {
    contentToCheck = toolInput.command || "";
  } else if (toolName === "Write" || toolName === "write") {
    contentToCheck = (toolInput.content || "") + " " + (toolInput.file_path || "");
  } else if (toolName === "Edit" || toolName === "edit") {
    contentToCheck = (toolInput.new_string || "") + " " + (toolInput.file_path || "");
  } else {
    return { block: false };
  }

  if (!contentToCheck.trim()) {
    return { block: false };
  }

  // Run all access control checks
  var checks = [
    checkHardcodedKeys(contentToCheck),
    checkRootUsage(contentToCheck),
    checkCredentialEmbedding(contentToCheck),
  ];

  for (var i = 0; i < checks.length; i++) {
    if (checks[i]) {
      return { block: true, reason: checks[i] };
    }
  }

  return { block: false };
}

module.exports = gate;

// CLI self-test when run directly
if (require.main === module) {
  var fs = require("fs");
  var input = JSON.parse(fs.readFileSync(0, "utf-8"));
  var result = gate(input);
  if (result.block) {
    process.stdout.write(JSON.stringify({ decision: "block", reason: result.reason }));
    process.exit(2);
  }
  process.exit(0);
}
