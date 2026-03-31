// NIST CSF 2.0 -- Access Control Enforcement Gate (PreToolUse)
// Controls: PR.AC-01 (access control), PR.DS-10 (key management)
//
// Blocks:
//   - Hardcoded AWS credentials (access keys, secret keys)
//   - Hardcoded passwords/tokens in source code
//   - Commands using long-term credentials instead of IAM roles
//   - Plaintext secrets in code or config files

"use strict";

var fs = require("fs");

var input = JSON.parse(fs.readFileSync(0, "utf-8"));
var toolName = input.tool_name || "";
var toolInput = input.tool_input || {};

var isBash = toolName === "Bash" || toolName === "bash";
var isWrite = toolName === "Write" || toolName === "write";
var isEdit = toolName === "Edit" || toolName === "edit";

if (!isBash && !isWrite && !isEdit) {
  process.exit(0);
}

var violations = [];

// Patterns for credential detection
var AWS_ACCESS_KEY = /\b(AKIA|ASIA)[A-Z0-9]{16}\b/;
var AWS_SECRET_KEY = /\b[A-Za-z0-9/+=]{40}\b/;
var AWS_SECRET_CONTEXT = /(aws_secret_access_key|secret_access_key|SecretAccessKey)\s*[=:]\s*/i;
var GENERIC_PASSWORD = /(password|passwd|pwd)\s*[=:]\s*["'][^"']{4,}["']/i;
var GENERIC_TOKEN = /(token|api_key|apikey|secret)\s*[=:]\s*["'][A-Za-z0-9_\-/.+=]{8,}["']/i;
var PRIVATE_KEY_BLOCK = /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/;
var HARDCODED_CREDS_CLI = /--aws-access-key-id\s+\S+|--aws-secret-access-key\s+\S+/;

// Files that are expected to contain patterns (test fixtures, docs)
function isExemptFile(path) {
  if (!path) return false;
  return /\.(md|txt|example|sample|template)$/.test(path) ||
    /test[_-]?fixture/i.test(path) ||
    /\.example$/i.test(path);
}

function checkContent(content, filePath, source) {
  // PR.AC-01: AWS Access Key IDs
  if (AWS_ACCESS_KEY.test(content)) {
    violations.push(
      "PR.AC-01: AWS Access Key ID detected in " + source + ". " +
      "Use IAM roles or AWS Secrets Manager instead of hardcoded credentials."
    );
  }

  // PR.AC-01: AWS Secret Keys (with context to reduce false positives)
  if (AWS_SECRET_CONTEXT.test(content) && AWS_SECRET_KEY.test(content)) {
    violations.push(
      "PR.AC-01: AWS Secret Access Key detected in " + source + ". " +
      "Use IAM roles or AWS Secrets Manager."
    );
  }

  // PR.AC-01: Hardcoded passwords
  if (GENERIC_PASSWORD.test(content)) {
    if (!isExemptFile(filePath)) {
      violations.push(
        "PR.AC-01: Hardcoded password detected in " + source + ". " +
        "Use a secrets manager or environment variable reference."
      );
    }
  }

  // PR.AC-01: Hardcoded API tokens
  if (GENERIC_TOKEN.test(content)) {
    if (!isExemptFile(filePath)) {
      violations.push(
        "PR.AC-01: Hardcoded API token/secret detected in " + source + ". " +
        "Use a secrets manager or encrypted parameter store."
      );
    }
  }

  // PR.DS-10: Private key material
  if (PRIVATE_KEY_BLOCK.test(content)) {
    violations.push(
      "PR.DS-10: Private key material detected in " + source + ". " +
      "Store keys in AWS KMS, Secrets Manager, or a secure vault."
    );
  }
}

if (isBash) {
  var cmd = toolInput.command || "";

  // PR.AC-01: CLI commands with hardcoded credentials
  if (HARDCODED_CREDS_CLI.test(cmd)) {
    violations.push(
      "PR.AC-01: Hardcoded AWS credentials in CLI command. " +
      "Use IAM roles, instance profiles, or aws configure with named profiles."
    );
  }

  // PR.AC-01: Inline AWS creds in env vars
  if (/AWS_ACCESS_KEY_ID=["']?(AKIA|ASIA)/.test(cmd)) {
    violations.push(
      "PR.AC-01: AWS credentials exported in command. " +
      "Use IAM roles or credential files."
    );
  }

  // Check the command body for embedded secrets
  checkContent(cmd, "", "bash command");
}

if (isWrite || isEdit) {
  var content = toolInput.content || toolInput.new_string || "";
  var filePath = toolInput.file_path || "";

  checkContent(content, filePath, filePath || "file");
}

if (violations.length > 0) {
  // Deduplicate
  var seen = {};
  var unique = [];
  for (var i = 0; i < violations.length; i++) {
    if (!seen[violations[i]]) {
      seen[violations[i]] = true;
      unique.push(violations[i]);
    }
  }
  var msg = "NIST CSF 2.0 COMPLIANCE BLOCK:\n" + unique.join("\n");
  process.stdout.write(msg);
  process.exit(2);
}

process.exit(0);
