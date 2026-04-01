// dispatcher-state.js -- Task queue and persistent state for the dispatcher brain.
// Pure functions + a State class. No side effects except file I/O in persist/load.

"use strict";

var fs = require("fs");
var path = require("path");

var DEFAULT_STATE_DIR = path.join(__dirname, ".dispatcher-state");
var STATE_FILE = "state.json";
var TODO_FILE = "TODO.md";

function makeId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function createTask(text, source) {
  return {
    id: makeId(),
    text: text,
    source: source || "api",
    status: "pending",
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    result: null,
  };
}

function State(stateDir) {
  this.dir = stateDir || DEFAULT_STATE_DIR;
  this.tasks = [];
  this.history = [];
  this.started_at = new Date().toISOString();
  this.total_completed = 0;
  this.total_failed = 0;
  this.last_heal_at = null;
}

State.prototype.ensureDir = function () {
  if (!fs.existsSync(this.dir)) {
    fs.mkdirSync(this.dir, { recursive: true });
  }
};

State.prototype.submit = function (text, source) {
  var task = createTask(text, source);
  this.tasks.push(task);
  this.persist();
  return task;
};

State.prototype.nextPending = function () {
  for (var i = 0; i < this.tasks.length; i++) {
    if (this.tasks[i].status === "pending") return this.tasks[i];
  }
  return null;
};

State.prototype.startTask = function (id) {
  var task = this.findTask(id);
  if (task && task.status === "pending") {
    task.status = "running";
    task.started_at = new Date().toISOString();
    this.persist();
  }
  return task;
};

State.prototype.completeTask = function (id, result) {
  var task = this.findTask(id);
  if (task && task.status === "running") {
    task.status = "completed";
    task.completed_at = new Date().toISOString();
    task.result = result || "done";
    this.total_completed++;
    this.history.push(task);
    this.tasks = this.tasks.filter(function (t) { return t.id !== id; });
    this.persist();
  }
  return task;
};

State.prototype.failTask = function (id, reason) {
  var task = this.findTask(id);
  if (task && (task.status === "running" || task.status === "pending")) {
    task.status = "failed";
    task.completed_at = new Date().toISOString();
    task.result = reason || "unknown error";
    this.total_failed++;
    this.history.push(task);
    this.tasks = this.tasks.filter(function (t) { return t.id !== id; });
    this.persist();
  }
  return task;
};

State.prototype.findTask = function (id) {
  for (var i = 0; i < this.tasks.length; i++) {
    if (this.tasks[i].id === id) return this.tasks[i];
  }
  return null;
};

State.prototype.counts = function () {
  var pending = 0, running = 0;
  for (var i = 0; i < this.tasks.length; i++) {
    if (this.tasks[i].status === "pending") pending++;
    if (this.tasks[i].status === "running") running++;
  }
  return {
    pending: pending,
    running: running,
    completed: this.total_completed,
    failed: this.total_failed,
    total_queued: this.tasks.length,
  };
};

State.prototype.healthData = function () {
  var uptime = Math.floor((Date.now() - new Date(this.started_at).getTime()) / 1000);
  return {
    status: "ok",
    service: "dispatcher-brain",
    uptime_seconds: uptime,
    started_at: this.started_at,
    last_heal_at: this.last_heal_at,
    tasks: this.counts(),
  };
};

State.prototype.recordHeal = function () {
  this.last_heal_at = new Date().toISOString();
  this.persist();
};

State.prototype.persist = function () {
  this.ensureDir();
  var data = {
    started_at: this.started_at,
    total_completed: this.total_completed,
    total_failed: this.total_failed,
    last_heal_at: this.last_heal_at,
    tasks: this.tasks,
    history: this.history.slice(-50),
  };
  fs.writeFileSync(path.join(this.dir, STATE_FILE), JSON.stringify(data, null, 2));
  this.writeTodo();
};

State.prototype.writeTodo = function () {
  var lines = ["# Dispatcher TODO", ""];
  lines.push("## Pending Tasks");
  var pending = this.tasks.filter(function (t) { return t.status === "pending"; });
  if (pending.length === 0) {
    lines.push("- (none)");
  } else {
    pending.forEach(function (t) {
      lines.push("- [ ] " + t.id + ": " + t.text.slice(0, 80));
    });
  }
  lines.push("");
  lines.push("## Running");
  var running = this.tasks.filter(function (t) { return t.status === "running"; });
  if (running.length === 0) {
    lines.push("- (none)");
  } else {
    running.forEach(function (t) {
      lines.push("- [~] " + t.id + ": " + t.text.slice(0, 80));
    });
  }
  lines.push("");
  lines.push("## Recent History (last 10)");
  var recent = this.history.slice(-10);
  if (recent.length === 0) {
    lines.push("- (none)");
  } else {
    recent.forEach(function (t) {
      var mark = t.status === "completed" ? "x" : "!";
      lines.push("- [" + mark + "] " + t.id + ": " + t.text.slice(0, 60) + " (" + t.status + ")");
    });
  }
  lines.push("");
  fs.writeFileSync(path.join(this.dir, TODO_FILE), lines.join("\n"));
};

State.prototype.load = function () {
  var fp = path.join(this.dir, STATE_FILE);
  if (!fs.existsSync(fp)) return;
  try {
    var data = JSON.parse(fs.readFileSync(fp, "utf8"));
    this.started_at = data.started_at || this.started_at;
    this.total_completed = data.total_completed || 0;
    this.total_failed = data.total_failed || 0;
    this.last_heal_at = data.last_heal_at || null;
    this.tasks = data.tasks || [];
    this.history = data.history || [];
  } catch (e) {
    // corrupted state -- start fresh
  }
};

module.exports = { State: State, createTask: createTask, makeId: makeId };
