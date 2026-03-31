// NIST CSF 2.0 -- Encryption Enforcement Gate (PreToolUse)
// Controls: PR.DS-01 (data at rest), PR.DS-02 (data in transit), PR.DS-10 (key management)
//
// Blocks:
//   - S3 PUT/CP without --sse aws:kms
//   - API calls using HTTP instead of HTTPS
//   - Secrets/credentials written without encryption

"use strict";

var fs = require("fs");

var input = JSON.parse(fs.readFileSync(0, "utf-8"));
var toolName = input.tool_name || "";
var toolInput = input.tool_input || {};

// Only inspect Bash and Write/Edit tool calls
var isBash = toolName === "Bash" || toolName === "bash";
var isWrite = toolName === "Write" || toolName === "write";
var isEdit = toolName === "Edit" || toolName === "edit";

if (!isBash && !isWrite && !isEdit) {
  process.exit(0);
}

var violations = [];

if (isBash) {
  var cmd = toolInput.command || "";

  // PR.DS-01: S3 uploads must use KMS encryption
  var s3PutPattern = /aws\s+s3\s+(cp|mv|sync)\b/;
  if (s3PutPattern.test(cmd)) {
    if (!/--sse\s+aws:kms/.test(cmd) && !/--server-side-encryption\s+aws:kms/.test(cmd)) {
      violations.push(
        "PR.DS-01: S3 upload detected without KMS encryption. " +
        "Add --sse aws:kms to the command."
      );
    }
    // PR.DS-10: If using KMS, prefer CMK over default key
    if (/--sse\s+aws:kms/.test(cmd) && !/--sse-kms-key-id/.test(cmd)) {
      // Advisory only -- don't block, just warn via context
    }
  }

  // PR.DS-01: s3api put-object must use ServerSideEncryption
  if (/aws\s+s3api\s+put-object/.test(cmd)) {
    if (!/--server-side-encryption\s+aws:kms/.test(cmd)) {
      violations.push(
        "PR.DS-01: s3api put-object without --server-side-encryption aws:kms. " +
        "All objects must be encrypted at rest with KMS."
      );
    }
  }

  // PR.DS-02: Block plaintext HTTP URLs for API calls (allow localhost/127.0.0.1)
  var httpPattern = /https?:\/\//g;
  var match;
  while ((match = httpPattern.exec(cmd)) !== null) {
    var urlStart = match.index;
    var urlSnippet = cmd.substring(urlStart, urlStart + 80);
    if (/^http:\/\//.test(urlSnippet)) {
      // Allow localhost and 127.0.0.1 for local dev
      if (!/^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(urlSnippet)) {
        violations.push(
          "PR.DS-02: HTTP URL detected (" + urlSnippet.substring(0, 40) + "...). " +
          "All API calls must use HTTPS for data in transit."
        );
        break; // One violation is enough
      }
    }
  }

  // PR.DS-02: curl without --ssl / to http
  if (/\bcurl\b/.test(cmd) && /\bhttp:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(cmd)) {
    // Already caught above, but double-check curl specifically
  }

  // PR.AC-01: Block export of secrets as plaintext env vars in commands
  var secretEnvPattern = /\b(AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|DATABASE_PASSWORD|DB_PASSWORD|API_KEY|API_SECRET|PRIVATE_KEY)=[^\s$]/i;
  if (secretEnvPattern.test(cmd)) {
    violations.push(
      "PR.DS-02/PR.AC-01: Plaintext secret detected in command environment. " +
      "Use AWS Secrets Manager, SSM Parameter Store, or encrypted env vars."
    );
  }
}

if (isWrite || isEdit) {
  var content = toolInput.content || toolInput.new_string || "";
  var filePath = toolInput.file_path || "";

  // PR.DS-01: Writing customer data files without mentioning encryption
  var customerDataPatterns = [
    /customer[_-]?data/i,
    /pii[_-]?data/i,
    /personal[_-]?info/i
  ];
  var isCustomerData = customerDataPatterns.some(function(p) { return p.test(filePath); });

  if (isCustomerData && !/encrypt/i.test(content)) {
    violations.push(
      "PR.DS-01: Writing customer data file without encryption reference. " +
      "Customer data must be encrypted at rest."
    );
  }

  // PR.DS-02: Hardcoded HTTP endpoints in config/code files
  if (/\bhttp:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(content)) {
    // Only flag in config/code files, not docs
    if (/\.(js|ts|py|json|yaml|yml|env|cfg|conf|ini|sh)$/.test(filePath)) {
      violations.push(
        "PR.DS-02: HTTP URL found in code/config file. " +
        "Use HTTPS for all external endpoints."
      );
    }
  }
}

if (violations.length > 0) {
  var msg = "NIST CSF 2.0 COMPLIANCE BLOCK:\n" + violations.join("\n");
  process.stdout.write(msg);
  process.exit(2);
}

// Pass -- no violations
process.exit(0);
