// NIST CSF 2.0 Encryption Gate
// PR.DS-01: Data-at-rest encryption (KMS)
// PR.DS-02: Data-in-transit encryption (TLS)
// PR.DS-10: Key management
//
// Blocks:
//   - aws s3 cp/sync without --sse aws:kms
//   - http:// URLs in curl/wget/fetch (must use https)
//   - Plaintext secret values in env vars or code

"use strict";

var ENCRYPTION_GATE_ID = "nist-encryption-gate";

/**
 * Check if an S3 command is missing KMS encryption.
 * Returns a reason string if blocked, null if OK.
 */
function checkS3Encryption(command) {
  // Match aws s3 cp or aws s3 sync commands
  var s3CopyPattern = /\baws\s+s3\s+(cp|sync)\b/i;
  if (!s3CopyPattern.test(command)) {
    return null;
  }

  // Allow if --sse aws:kms is present
  if (/--sse\s+aws:kms/i.test(command)) {
    return null;
  }

  // Allow if --sse-c is present (customer-managed key)
  if (/--sse-c\b/i.test(command)) {
    return null;
  }

  // Allow S3 reads (downloads) -- no --sse needed for GET
  // If the source is s3:// and dest is local (no s3:// as second arg), it's a download
  var args = command.replace(/\baws\s+s3\s+(cp|sync)\b/i, "").trim();
  var parts = args.split(/\s+/).filter(function(p) { return !p.startsWith("--"); });
  if (parts.length >= 2 && parts[0].startsWith("s3://") && !parts[1].startsWith("s3://")) {
    return null; // downloading from S3, no encryption flag needed
  }

  return "[PR.DS-01] S3 upload must use server-side encryption. Add --sse aws:kms to your aws s3 cp/sync command.";
}

/**
 * Check for insecure HTTP URLs in network commands.
 * Returns a reason string if blocked, null if OK.
 */
function checkTransitEncryption(command) {
  // Match curl, wget, fetch, or http:// in general commands
  var httpPattern = /\bhttp:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i;

  if (!httpPattern.test(command)) {
    return null;
  }

  // Check if it's in a network command context
  var networkCmdPattern = /\b(curl|wget|fetch|http\.get|requests\.get|requests\.post|axios|got|node-fetch|urllib)\b/i;
  if (networkCmdPattern.test(command)) {
    return "[PR.DS-02] Insecure HTTP detected in network command. Use https:// for data in transit. Localhost exceptions: 127.0.0.1, localhost, [::1].";
  }

  // Also block http:// in environment variable assignments
  var envPattern = /\b(export\s+\w+=|ENV\s+\w+=|\w+_URL=|\w+_ENDPOINT=)/i;
  if (envPattern.test(command)) {
    return "[PR.DS-02] Insecure HTTP URL in environment variable. Use https:// for all external endpoints.";
  }

  return null;
}

/**
 * Check for plaintext secrets in commands or code.
 * Returns a reason string if blocked, null if OK.
 */
function checkPlaintextSecrets(command) {
  var patterns = [
    // AWS secret access key pattern (40 char base64)
    { regex: /\b[A-Za-z0-9/+=]{40}\b/, context: /\b(SECRET_ACCESS_KEY|secret_key|aws_secret)\b/i, msg: "AWS secret access key" },
    // Generic password/secret/token assignments with literal values
    { regex: /(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)\s*[=:]\s*["'][^"']{8,}["']/i, context: null, msg: "hardcoded secret value" },
    // export SECRET=value patterns
    { regex: /export\s+(PASSWORD|SECRET|TOKEN|API_KEY|AWS_SECRET_ACCESS_KEY)\s*=\s*[^\$\{]/i, context: null, msg: "plaintext secret in export" },
  ];

  for (var i = 0; i < patterns.length; i++) {
    var p = patterns[i];
    if (p.context) {
      if (p.regex.test(command) && p.context.test(command)) {
        return "[PR.DS-10] Plaintext " + p.msg + " detected. Use AWS Secrets Manager, SSM Parameter Store, or environment variable references ($VAR) instead.";
      }
    } else {
      if (p.regex.test(command)) {
        return "[PR.DS-10] Plaintext " + p.msg + " detected. Use AWS Secrets Manager, SSM Parameter Store, or environment variable references ($VAR) instead.";
      }
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

  // Only check Bash commands and Write/Edit content
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

  // Run all encryption checks
  var checks = [
    checkS3Encryption(contentToCheck),
    checkTransitEncryption(contentToCheck),
    checkPlaintextSecrets(contentToCheck),
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
