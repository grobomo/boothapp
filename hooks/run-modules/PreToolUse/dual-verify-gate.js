// dual-verify-gate.js — PreToolUse hook module
// Blocks 'gh pr merge' unless BOTH worker-passed AND manager-reviewed markers exist.
// Extracts task number from PR title matching /T\d+/.

var fs = require("fs");
var path = require("path");
var childProcess = require("child_process");

function extractTaskNumber(command) {
  // Look for PR number in the gh pr merge command
  var prMatch = command.match(/gh\s+pr\s+merge\s+(\d+)/);
  if (!prMatch) return null;

  var prNumber = prMatch[1];

  // Get PR title via gh cli to extract task number
  try {
    var result = childProcess.execSync(
      "gh pr view " + prNumber + " --json title --jq .title",
      { encoding: "utf-8", timeout: 10000 }
    ).trim();
    var taskMatch = result.match(/T(\d+)/);
    return taskMatch ? taskMatch[1] : null;
  } catch (e) {
    return null;
  }
}

function extractTaskFromBranch() {
  // Fallback: extract from current branch name
  try {
    var branch = childProcess.execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      timeout: 5000
    }).trim();
    var match = branch.match(/T(\d+)/i);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

function checkMarkers(taskNumber) {
  var testResultsDir = path.join(process.cwd(), ".test-results");
  var workerFile = path.join(testResultsDir, "T" + taskNumber + ".worker-passed");
  var managerFile = path.join(testResultsDir, "T" + taskNumber + ".manager-reviewed");

  var workerExists = false;
  var managerExists = false;

  try { workerExists = fs.statSync(workerFile).isFile(); } catch (e) { /* noop */ }
  try { managerExists = fs.statSync(managerFile).isFile(); } catch (e) { /* noop */ }

  return {
    workerPassed: workerExists,
    managerReviewed: managerExists,
    workerFile: workerFile,
    managerFile: managerFile
  };
}

function main() {
  var input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf-8"));
  } catch (e) {
    process.exit(0); // Can't parse input, allow through
  }

  // Only gate 'gh pr merge' commands
  var toolName = input.tool_name || "";
  if (toolName !== "Bash") {
    process.exit(0);
  }

  var command = "";
  if (input.tool_input && input.tool_input.command) {
    command = input.tool_input.command;
  }

  if (!/gh\s+pr\s+merge/.test(command)) {
    process.exit(0); // Not a merge command, allow
  }

  // Extract task number from PR title or branch
  var taskNumber = extractTaskNumber(command);
  if (!taskNumber) {
    taskNumber = extractTaskFromBranch();
  }

  if (!taskNumber) {
    process.stdout.write(
      "DUAL-VERIFY GATE: Could not extract task number (T###) from PR title or branch. " +
      "Ensure PR title contains a task number like T001."
    );
    process.exit(2); // Block
  }

  var markers = checkMarkers(taskNumber);
  var missing = [];

  if (!markers.workerPassed) {
    missing.push("Worker verification missing: " + markers.workerFile);
  }
  if (!markers.managerReviewed) {
    missing.push("Manager review missing: " + markers.managerFile);
  }

  if (missing.length > 0) {
    process.stdout.write(
      "DUAL-VERIFY GATE BLOCKED: Cannot merge PR for T" + taskNumber + ".\n" +
      missing.join("\n") + "\n\n" +
      "Both verifications required before merge:\n" +
      "  1. Run: scripts/fleet/worker-verify.sh T" + taskNumber + "\n" +
      "  2. Run: scripts/fleet/manager-review.sh T" + taskNumber + "\n"
    );
    process.exit(2); // Block merge
  }

  // Both markers exist — allow merge
  process.stdout.write(
    "DUAL-VERIFY GATE: T" + taskNumber + " has both worker and manager verification. Merge allowed."
  );
  process.exit(0);
}

main();
