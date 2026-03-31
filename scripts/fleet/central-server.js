#!/usr/bin/env node
// central-server.js -- Dashboard server with /fleet-tune endpoint
// Shows current vs desired node counts with color coding.

var http = require("http");
var fs = require("fs");
var path = require("path");

var CONFIG_PATH = path.join(__dirname, "tune-config.json");
var PORT = parseInt(process.env.DASHBOARD_PORT || "3200", 10);

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function fetchJSON(url) {
  return new Promise(function (resolve, reject) {
    var mod = url.startsWith("https") ? require("https") : http;
    mod
      .get(url, function (res) {
        var body = "";
        res.on("data", function (c) {
          body += c;
        });
        res.on("end", function () {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error("Invalid JSON from " + url));
          }
        });
      })
      .on("error", reject);
  });
}

function calcDesired(pendingTasks, ratios) {
  var workers = Math.max(pendingTasks * ratios.workers_per_pending_task, ratios.min_workers);
  var monitors = Math.max(Math.ceil(workers / ratios.workers_per_monitor), ratios.min_monitors);
  var dispatchers = ratios.dispatchers;
  return { workers: workers, monitors: monitors, dispatchers: dispatchers };
}

function statusColor(actual, desired, thresholds) {
  if (actual === desired) return { color: "green", status: "MATCHED" };
  var diff = Math.abs(desired - actual);
  var pct = actual === 0 ? 100 : Math.round((diff / actual) * 100);
  if (pct >= thresholds.critical_percent) return { color: "red", status: "CRITICAL" };
  if (pct >= thresholds.drift_percent) return { color: "yellow", status: "DRIFT" };
  return { color: "green", status: "MINOR" };
}

function actionText(actual, desired, role) {
  var diff = desired - actual;
  if (diff > 0) return "add " + diff + " " + role + "(s)";
  if (diff < 0) return "remove " + Math.abs(diff) + " " + role + "(s)";
  return "none";
}

function renderHTML(data) {
  var rows = data.roles
    .map(function (r) {
      var bg =
        r.color === "red"
          ? "#ff4444"
          : r.color === "yellow"
            ? "#ffaa00"
            : "#44bb44";
      var text = r.color === "yellow" ? "#000" : "#fff";
      return (
        "<tr>" +
        '<td style="font-weight:bold">' + r.role + "</td>" +
        "<td>" + r.actual + "</td>" +
        "<td>" + r.desired + "</td>" +
        "<td>" + (r.desired - r.actual) + "</td>" +
        '<td style="background:' + bg + ";color:" + text + ";font-weight:bold;text-align:center" + '">' +
        r.status +
        "</td>" +
        "<td>" + r.action + "</td>" +
        "</tr>"
      );
    })
    .join("\n");

  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><title>Fleet Tuning Dashboard</title>',
    "<style>",
    "  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 2rem; background: #1a1a2e; color: #eee; }",
    "  h1 { color: #00d4ff; }",
    "  .meta { color: #aaa; margin-bottom: 1rem; }",
    "  table { border-collapse: collapse; width: 100%; max-width: 800px; }",
    "  th, td { padding: 10px 16px; border: 1px solid #333; text-align: left; }",
    "  th { background: #16213e; color: #00d4ff; }",
    "  tr:nth-child(even) { background: #0f3460; }",
    "  tr:nth-child(odd) { background: #1a1a2e; }",
    "  .legend { margin-top: 1.5rem; font-size: 0.9rem; }",
    "  .legend span { display: inline-block; width: 14px; height: 14px; border-radius: 3px; vertical-align: middle; margin-right: 4px; }",
    "  .legend .g { background: #44bb44; } .legend .y { background: #ffaa00; } .legend .r { background: #ff4444; }",
    "</style></head><body>",
    "<h1>Fleet Tuning Dashboard</h1>",
    '<p class="meta">Pending tasks: <strong>' + data.pending_tasks + "</strong> | " + new Date().toISOString() + "</p>",
    "<table>",
    "<tr><th>Role</th><th>Actual</th><th>Desired</th><th>Delta</th><th>Status</th><th>Action</th></tr>",
    rows,
    "</table>",
    '<div class="legend">',
    '<span class="g"></span> Green = Matched &nbsp; <span class="y"></span> Yellow = Drift &nbsp; <span class="r"></span> Red = Critical',
    "</div>",
    "</body></html>",
  ].join("\n");
}

function buildTuneData(health, config) {
  var pendingTasks = health.pending_tasks || (health.queue && health.queue.pending) || 0;
  var actual = {
    workers: (health.nodes && health.nodes.workers) || health.workers || 0,
    monitors: (health.nodes && health.nodes.monitors) || health.monitors || 0,
    dispatchers: (health.nodes && health.nodes.dispatchers) || health.dispatchers || 1,
  };
  var desired = calcDesired(pendingTasks, config.ratios);
  var roles = ["workers", "monitors", "dispatchers"].map(function (role) {
    var sc = statusColor(actual[role], desired[role], config.thresholds);
    return {
      role: role,
      actual: actual[role],
      desired: desired[role],
      color: sc.color,
      status: sc.status,
      action: actionText(actual[role], desired[role], role),
    };
  });
  return { pending_tasks: pendingTasks, roles: roles };
}

var server = http.createServer(function (req, res) {
  if (req.url === "/fleet-tune" || req.url === "/fleet-tune/") {
    var config = loadConfig();
    fetchJSON(config.dispatcher_url + "/health")
      .then(function (health) {
        var data = buildTuneData(health, config);

        var accept = req.headers.accept || "";
        if (accept.indexOf("application/json") !== -1) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data, null, 2));
        } else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(renderHTML(data));
        }
      })
      .catch(function (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Dispatcher unreachable", detail: err.message }));
      });
    return;
  }

  // health check for the dashboard itself
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "fleet-dashboard" }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found. Try /fleet-tune\n");
});

server.listen(PORT, function () {
  console.log("Fleet dashboard listening on http://localhost:" + PORT);
  console.log("  /fleet-tune  -- tuning dashboard");
  console.log("  /health      -- dashboard health");
});
