/**
 * blocker-gate.js -- PreToolUse hook module
 *
 * If a worker encounters 3 consecutive failures on the same task,
 * it MUST create a blocker before retrying.
 *
 * State is tracked in BLOCKERS_DIR/<task-id>-failures.json.
 * When failure count hits 3, this hook blocks the tool call and
 * instructs the worker to run blocker-system.sh first.
 *
 * Contract:
 *   stdin:  { tool_name, tool_input }  (PreToolUse hook input)
 *   stdout: context string (exit 0 = allow) or block message (exit 2 = block)
 */

var fs = require("fs");
var path = require("path");

var FAILURE_THRESHOLD = 3;
var PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();
var BLOCKERS_DIR = path.join(PROJECT_ROOT, "blockers");
var TASK_ID = process.env.FLEET_TASK_ID || "";

/**
 * Read failure tracking file for a task.
 * Returns { count: number, last_tool: string, consecutive: boolean }
 */
function readFailures(taskId) {
    var filePath = path.join(BLOCKERS_DIR, taskId + "-failures.json");
    try {
        var data = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(data);
    } catch (e) {
        return { count: 0, last_tool: "", tools: [], created_at: null };
    }
}

/**
 * Check if a blocker already exists for this task.
 */
function blockerExists(taskId) {
    var filePath = path.join(BLOCKERS_DIR, taskId + ".json");
    try {
        fs.accessSync(filePath);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Main hook logic.
 */
function main() {
    // Read stdin synchronously
    var input;
    try {
        var raw = fs.readFileSync(0, "utf-8");
        input = JSON.parse(raw);
    } catch (e) {
        // Can't parse input -- allow the call
        process.exit(0);
    }

    var toolName = input.tool_name || "";

    // Only gate Bash, Write, Edit tools (execution tools that can fail)
    var gatedTools = ["Bash", "Write", "Edit"];
    if (gatedTools.indexOf(toolName) === -1) {
        process.exit(0);
    }

    // Need a task ID to track failures
    if (!TASK_ID) {
        process.exit(0);
    }

    var failures = readFailures(TASK_ID);

    // If we've hit the threshold and no blocker exists, block
    if (failures.count >= FAILURE_THRESHOLD && !blockerExists(TASK_ID)) {
        var msg = "BLOCKED: Task " + TASK_ID + " has " + failures.count +
            " consecutive failures. You MUST create a blocker before retrying.\n" +
            "Run: scripts/fleet/blocker-system.sh " + TASK_ID + " '<description>' " +
            "--stack-trace '<last error>' --attempts '<what you tried>'\n" +
            "Failed tools: " + (failures.tools || []).join(", ");

        process.stdout.write(msg);
        process.exit(2);
    }

    // Allow the call -- add context if failures are accumulating
    if (failures.count > 0) {
        process.stdout.write(
            "NOTE: Task " + TASK_ID + " has " + failures.count + "/" +
            FAILURE_THRESHOLD + " consecutive failures. " +
            "If this attempt fails, create a blocker."
        );
    }

    process.exit(0);
}

module.exports = main;

// Direct execution
if (require.main === module) {
    main();
}
