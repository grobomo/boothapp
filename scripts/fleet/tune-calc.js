// tune-calc.js -- Pure calculation functions for fleet tuning.
// Extracted so both central-server.js and fleet-tune.sh can share logic,
// and so it can be unit-tested independently.

"use strict";

function calcDesired(pendingTasks, ratios) {
  var workers = Math.max(
    pendingTasks * ratios.workers_per_pending_task,
    ratios.min_workers
  );
  var monitors = Math.max(
    Math.ceil(workers / ratios.workers_per_monitor),
    ratios.min_monitors
  );
  var dispatchers = ratios.dispatchers;
  return { workers: workers, monitors: monitors, dispatchers: dispatchers };
}

function statusColor(actual, desired, thresholds) {
  if (actual === desired) return { color: "green", status: "MATCHED" };
  var diff = Math.abs(desired - actual);
  var pct = actual === 0 ? 100 : Math.round((diff / actual) * 100);
  if (pct >= thresholds.critical_percent)
    return { color: "red", status: "CRITICAL" };
  if (pct >= thresholds.drift_percent)
    return { color: "yellow", status: "DRIFT" };
  return { color: "green", status: "MINOR" };
}

function actionText(actual, desired, role) {
  var diff = desired - actual;
  if (diff > 0) return "add " + diff + " " + role + "(s)";
  if (diff < 0) return "remove " + Math.abs(diff) + " " + role + "(s)";
  return "none";
}

function buildTuneData(health, config) {
  var pendingTasks =
    health.pending_tasks || (health.queue && health.queue.pending) || 0;
  var actual = {
    workers: (health.nodes && health.nodes.workers) || health.workers || 0,
    monitors: (health.nodes && health.nodes.monitors) || health.monitors || 0,
    dispatchers:
      (health.nodes && health.nodes.dispatchers) || health.dispatchers || 1,
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

module.exports = { calcDesired, statusColor, actionText, buildTuneData };
