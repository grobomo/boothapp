#!/usr/bin/env node
// dispatcher-server.js -- HTTP server for the dispatcher brain.
// Accepts tasks via POST /api/submit, exposes health, dashboard, and A2A endpoints.
// Writes tasks to a FIFO so the persistent shell session picks them up.

"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var childProcess = require("child_process");
var stateModule = require("./dispatcher-state");

var State = stateModule.State;

var PORT = parseInt(process.env.DISPATCHER_PORT || "3100", 10);
var FIFO_PATH = process.env.DISPATCHER_FIFO || path.join(__dirname, ".dispatcher-state", "brain.fifo");
var HEAL_INTERVAL_MS = parseInt(process.env.HEAL_INTERVAL_MS || "600000", 10); // 10 min
var HEAL_SCRIPT = process.env.HEAL_SCRIPT || path.join(__dirname, "fleet-heal.sh");

var state = new State();
state.load();

// -- FIFO writing ----------------------------------------------------------

function writeToFifo(text) {
  try {
    var fd = fs.openSync(FIFO_PATH, "w");
    fs.writeSync(fd, text + "\n");
    fs.closeSync(fd);
    return true;
  } catch (e) {
    console.error("FIFO write failed:", e.message);
    return false;
  }
}

// -- Fleet heal timer ------------------------------------------------------

var healTimer = null;

function runHeal() {
  if (!fs.existsSync(HEAL_SCRIPT)) {
    console.log("fleet-heal.sh not found at " + HEAL_SCRIPT + ", skipping");
    state.recordHeal();
    return;
  }
  console.log("[heal] Running fleet-heal.sh at " + new Date().toISOString());
  childProcess.exec("bash " + HEAL_SCRIPT, { timeout: 120000 }, function (err, stdout, stderr) {
    if (err) {
      console.error("[heal] Error:", err.message);
    } else {
      console.log("[heal] Done:", stdout.trim().slice(0, 200));
    }
    state.recordHeal();
  });
}

function startHealTimer() {
  if (healTimer) clearInterval(healTimer);
  healTimer = setInterval(runHeal, HEAL_INTERVAL_MS);
  // Run once at startup after a short delay
  setTimeout(runHeal, 5000);
}

// -- Request body reader ---------------------------------------------------

function readBody(req, cb) {
  var chunks = [];
  req.on("data", function (c) { chunks.push(c); });
  req.on("end", function () { cb(Buffer.concat(chunks).toString()); });
}

function parseJSON(body) {
  try { return JSON.parse(body); } catch (e) { return null; }
}

// -- Dashboard HTML --------------------------------------------------------

function dashboardHTML() {
  var h = state.healthData();
  var c = h.tasks;
  var taskRows = state.tasks.map(function (t) {
    var statusBg = t.status === "running" ? "#ffaa00" : "#555";
    return "<tr>" +
      "<td><code>" + t.id + "</code></td>" +
      "<td>" + escHtml(t.text.slice(0, 100)) + "</td>" +
      "<td>" + t.source + "</td>" +
      '<td style="background:' + statusBg + ';text-align:center;font-weight:bold">' + t.status + "</td>" +
      "<td>" + t.created_at + "</td>" +
      "</tr>";
  }).join("\n");

  var historyRows = state.history.slice(-15).reverse().map(function (t) {
    var bg = t.status === "completed" ? "#2a5a2a" : "#5a2a2a";
    return "<tr style='background:" + bg + "'>" +
      "<td><code>" + t.id + "</code></td>" +
      "<td>" + escHtml(t.text.slice(0, 80)) + "</td>" +
      "<td>" + t.status + "</td>" +
      "<td>" + (t.result || "").slice(0, 60) + "</td>" +
      "<td>" + t.completed_at + "</td>" +
      "</tr>";
  }).join("\n");

  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><title>Dispatcher Brain</title>',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="refresh" content="15">',
    "<style>",
    "  * { box-sizing: border-box; }",
    "  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 2rem; background: #0d1117; color: #c9d1d9; }",
    "  h1 { color: #58a6ff; margin-bottom: 0.5rem; }",
    "  h2 { color: #8b949e; font-size: 1.1rem; margin-top: 2rem; }",
    "  .stats { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }",
    "  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.5rem; min-width: 120px; }",
    "  .stat .label { color: #8b949e; font-size: 0.8rem; text-transform: uppercase; }",
    "  .stat .value { color: #58a6ff; font-size: 1.8rem; font-weight: bold; }",
    "  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }",
    "  th, td { padding: 8px 12px; border: 1px solid #30363d; text-align: left; font-size: 0.85rem; }",
    "  th { background: #161b22; color: #58a6ff; }",
    "  tr:nth-child(even) { background: #0d1117; }",
    "  tr:nth-child(odd) { background: #161b22; }",
    "  code { background: #1f2937; padding: 2px 6px; border-radius: 3px; font-size: 0.8rem; }",
    "  .submit-form { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; margin: 1.5rem 0; }",
    "  .submit-form textarea { width: 100%; min-height: 80px; background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; padding: 0.75rem; font-family: inherit; font-size: 0.9rem; resize: vertical; }",
    "  .submit-form button { margin-top: 0.75rem; padding: 0.6rem 1.5rem; background: #238636; color: #fff; border: none; border-radius: 6px; font-size: 0.9rem; cursor: pointer; font-weight: 600; }",
    "  .submit-form button:hover { background: #2ea043; }",
    "  .submit-result { margin-top: 0.5rem; padding: 0.5rem; background: #1f2937; border-radius: 4px; display: none; font-size: 0.85rem; }",
    "  .heal-info { color: #8b949e; font-size: 0.85rem; }",
    "</style></head><body>",
    "<h1>Dispatcher Brain</h1>",
    '<p class="heal-info">Uptime: ' + h.uptime_seconds + 's | Last heal: ' + (h.last_heal_at || "never") + " | " + new Date().toISOString() + "</p>",
    "",
    '<div class="stats">',
    '  <div class="stat"><div class="label">Pending</div><div class="value">' + c.pending + "</div></div>",
    '  <div class="stat"><div class="label">Running</div><div class="value">' + c.running + "</div></div>",
    '  <div class="stat"><div class="label">Completed</div><div class="value">' + c.completed + "</div></div>",
    '  <div class="stat"><div class="label">Failed</div><div class="value">' + c.failed + "</div></div>",
    "</div>",
    "",
    "<h2>Submit Task</h2>",
    '<div class="submit-form">',
    '  <textarea id="taskText" placeholder="Describe the task for the dispatcher..."></textarea>',
    '  <button onclick="submitTask()">Submit Task</button>',
    '  <div id="submitResult" class="submit-result"></div>',
    "</div>",
    "<script>",
    "function submitTask() {",
    '  var text = document.getElementById("taskText").value.trim();',
    "  if (!text) return;",
    '  var el = document.getElementById("submitResult");',
    '  el.style.display = "block";',
    '  el.textContent = "Submitting...";',
    '  fetch("/api/submit", {',
    '    method: "POST",',
    '    headers: { "Content-Type": "application/json" },',
    "    body: JSON.stringify({ task: text })",
    "  })",
    "  .then(function(r) { return r.json(); })",
    "  .then(function(d) {",
    '    el.textContent = "Submitted: " + d.task.id + " (" + d.task.status + ")";',
    '    el.style.color = "#3fb950";',
    '    document.getElementById("taskText").value = "";',
    "    setTimeout(function() { location.reload(); }, 1500);",
    "  })",
    "  .catch(function(e) {",
    '    el.textContent = "Error: " + e.message;',
    '    el.style.color = "#f85149";',
    "  });",
    "}",
    "</script>",
    "",
    "<h2>Active Queue</h2>",
    state.tasks.length === 0 ? "<p>No active tasks.</p>" : [
      "<table>",
      "<tr><th>ID</th><th>Task</th><th>Source</th><th>Status</th><th>Created</th></tr>",
      taskRows,
      "</table>"
    ].join("\n"),
    "",
    "<h2>Recent History</h2>",
    state.history.length === 0 ? "<p>No completed tasks yet.</p>" : [
      "<table>",
      "<tr><th>ID</th><th>Task</th><th>Status</th><th>Result</th><th>Completed</th></tr>",
      historyRows,
      "</table>"
    ].join("\n"),
    "",
    "</body></html>",
  ].join("\n");
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// -- HTTP handlers ---------------------------------------------------------

function handleSubmit(req, res) {
  readBody(req, function (body) {
    var data = parseJSON(body);
    if (!data || !data.task) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'task' field in JSON body" }));
      return;
    }
    var task = state.submit(data.task, data.source || "dashboard");
    var fifoOk = writeToFifo(JSON.stringify({ type: "task", id: task.id, text: task.text }));
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true, task: task, fifo_delivered: fifoOk }));
  });
}

function handleA2A(req, res) {
  readBody(req, function (body) {
    var data = parseJSON(body);
    if (!data || !data.message) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'message' field" }));
      return;
    }
    var source = "a2a:" + (data.agent_id || "unknown");
    var task = state.submit(data.message, source);
    var fifoOk = writeToFifo(JSON.stringify({ type: "a2a", id: task.id, agent: data.agent_id, text: data.message }));
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true, task: task, fifo_delivered: fifoOk }));
  });
}

function handleHealth(req, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(state.healthData(), null, 2));
}

function handleTaskStatus(req, res, taskId) {
  var task = state.findTask(taskId);
  if (!task) {
    // Check history
    for (var i = 0; i < state.history.length; i++) {
      if (state.history[i].id === taskId) { task = state.history[i]; break; }
    }
  }
  if (!task) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Task not found" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(task));
}

function handleComplete(req, res) {
  readBody(req, function (body) {
    var data = parseJSON(body);
    if (!data || !data.id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'id' field" }));
      return;
    }
    var task;
    if (data.status === "failed") {
      task = state.failTask(data.id, data.result);
    } else {
      task = state.completeTask(data.id, data.result);
    }
    if (!task) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found or not in correct state" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ updated: true, task: task }));
  });
}

// -- Router ----------------------------------------------------------------

var server = http.createServer(function (req, res) {
  // CORS headers for dashboard fetch calls
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  var url = req.url.split("?")[0];

  if (url === "/" || url === "/submit") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(dashboardHTML());
    return;
  }

  if (url === "/health") {
    handleHealth(req, res);
    return;
  }

  if (url === "/api/submit" && req.method === "POST") {
    handleSubmit(req, res);
    return;
  }

  if (url === "/api/a2a" && req.method === "POST") {
    handleA2A(req, res);
    return;
  }

  if (url === "/api/complete" && req.method === "POST") {
    handleComplete(req, res);
    return;
  }

  // /api/task/:id
  var taskMatch = url.match(/^\/api\/task\/([a-z0-9-]+)$/);
  if (taskMatch && req.method === "GET") {
    handleTaskStatus(req, res, taskMatch[1]);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// -- Exports for testing ---------------------------------------------------

module.exports = {
  state: state,
  server: server,
  startHealTimer: startHealTimer,
  writeToFifo: writeToFifo,
  escHtml: escHtml,
  _healTimer: function () { return healTimer; },
};

// -- Start if run directly -------------------------------------------------

if (require.main === module) {
  startHealTimer();
  server.listen(PORT, function () {
    console.log("Dispatcher brain server listening on http://localhost:" + PORT);
    console.log("  /           -- dashboard + submit form");
    console.log("  /health     -- health + task counts");
    console.log("  /api/submit -- POST task submission");
    console.log("  /api/a2a    -- POST agent-to-agent messages");
    console.log("  FIFO: " + FIFO_PATH);
  });
}
