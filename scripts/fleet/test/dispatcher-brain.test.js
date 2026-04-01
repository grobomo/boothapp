"use strict";

var assert = require("assert");
var http = require("http");
var path = require("path");
var fs = require("fs");
var os = require("os");

// -- State tests -----------------------------------------------------------

var stateModule = require("../dispatcher-state");
var State = stateModule.State;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dispatcher-test-"));
}

function rmrf(dir) {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(function (f) {
      fs.unlinkSync(path.join(dir, f));
    });
    fs.rmdirSync(dir);
  }
}

console.log("--- State: task lifecycle ---");

{
  var dir = tmpDir();
  var s = new State(dir);
  var t = s.submit("build the thing", "test");
  assert.strictEqual(t.status, "pending");
  assert.strictEqual(t.text, "build the thing");
  assert.strictEqual(t.source, "test");
  assert.ok(t.id.length > 5, "id should be non-empty");
  console.log("  PASS: submit creates pending task");
  rmrf(dir);
}

{
  var dir = tmpDir();
  var s = new State(dir);
  var t = s.submit("task one");
  s.startTask(t.id);
  assert.strictEqual(t.status, "running");
  assert.ok(t.started_at !== null);
  console.log("  PASS: startTask sets running");
  rmrf(dir);
}

{
  var dir = tmpDir();
  var s = new State(dir);
  var t = s.submit("task one");
  s.startTask(t.id);
  s.completeTask(t.id, "all good");
  assert.strictEqual(s.tasks.length, 0, "task removed from active queue");
  assert.strictEqual(s.history.length, 1, "task moved to history");
  assert.strictEqual(s.history[0].status, "completed");
  assert.strictEqual(s.history[0].result, "all good");
  assert.strictEqual(s.total_completed, 1);
  console.log("  PASS: completeTask moves to history");
  rmrf(dir);
}

{
  var dir = tmpDir();
  var s = new State(dir);
  var t = s.submit("doomed task");
  s.startTask(t.id);
  s.failTask(t.id, "crashed");
  assert.strictEqual(s.tasks.length, 0);
  assert.strictEqual(s.history[0].status, "failed");
  assert.strictEqual(s.total_failed, 1);
  console.log("  PASS: failTask moves to history with failed status");
  rmrf(dir);
}

console.log("--- State: nextPending ---");

{
  var dir = tmpDir();
  var s = new State(dir);
  assert.strictEqual(s.nextPending(), null, "empty queue returns null");
  s.submit("a");
  s.submit("b");
  var next = s.nextPending();
  assert.strictEqual(next.text, "a", "returns first pending");
  s.startTask(next.id);
  next = s.nextPending();
  assert.strictEqual(next.text, "b", "skips running tasks");
  console.log("  PASS: nextPending returns first pending, skips running");
  rmrf(dir);
}

console.log("--- State: counts ---");

{
  var dir = tmpDir();
  var s = new State(dir);
  s.submit("a");
  s.submit("b");
  s.submit("c");
  s.startTask(s.tasks[0].id);
  var c = s.counts();
  assert.strictEqual(c.pending, 2);
  assert.strictEqual(c.running, 1);
  assert.strictEqual(c.total_queued, 3);
  console.log("  PASS: counts are accurate");
  rmrf(dir);
}

console.log("--- State: healthData ---");

{
  var dir = tmpDir();
  var s = new State(dir);
  s.submit("test");
  var h = s.healthData();
  assert.strictEqual(h.status, "ok");
  assert.strictEqual(h.service, "dispatcher-brain");
  assert.ok(h.uptime_seconds >= 0);
  assert.strictEqual(h.tasks.pending, 1);
  console.log("  PASS: healthData returns correct structure");
  rmrf(dir);
}

console.log("--- State: persistence ---");

{
  var dir = tmpDir();
  var s1 = new State(dir);
  s1.submit("persist me");
  s1.submit("and me");
  s1.startTask(s1.tasks[0].id);
  s1.completeTask(s1.tasks[0].id, "done");

  var s2 = new State(dir);
  s2.load();
  assert.strictEqual(s2.tasks.length, 1, "one task remains after reload");
  assert.strictEqual(s2.tasks[0].text, "and me");
  assert.strictEqual(s2.total_completed, 1);
  assert.strictEqual(s2.history.length, 1);
  console.log("  PASS: state persists and reloads correctly");
  rmrf(dir);
}

console.log("--- State: TODO.md generation ---");

{
  var dir = tmpDir();
  var s = new State(dir);
  s.submit("write tests");
  s.submit("deploy app");
  s.startTask(s.tasks[0].id);
  var todo = fs.readFileSync(path.join(dir, "TODO.md"), "utf8");
  assert.ok(todo.indexOf("# Dispatcher TODO") !== -1, "has header");
  assert.ok(todo.indexOf("deploy app") !== -1, "has pending task");
  assert.ok(todo.indexOf("write tests") !== -1, "has running task");
  console.log("  PASS: TODO.md is generated with task info");
  rmrf(dir);
}

console.log("--- State: recordHeal ---");

{
  var dir = tmpDir();
  var s = new State(dir);
  assert.strictEqual(s.last_heal_at, null);
  s.recordHeal();
  assert.ok(s.last_heal_at !== null);
  console.log("  PASS: recordHeal sets timestamp");
  rmrf(dir);
}

// -- Server tests ----------------------------------------------------------

console.log("--- Server: escHtml ---");

var serverModule = require("../dispatcher-server");

{
  assert.strictEqual(serverModule.escHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  console.log("  PASS: escHtml escapes HTML entities");
}

// -- HTTP integration tests ------------------------------------------------

console.log("--- Server: HTTP endpoints ---");

var TEST_PORT = 13100 + Math.floor(Math.random() * 1000);
var serverState = serverModule.state;

// Reset state for clean tests
serverState.tasks = [];
serverState.history = [];
serverState.total_completed = 0;
serverState.total_failed = 0;

function request(method, urlPath, body, cb) {
  var opts = {
    hostname: "localhost",
    port: TEST_PORT,
    path: urlPath,
    method: method,
    headers: { "Content-Type": "application/json" },
  };
  var req = http.request(opts, function (res) {
    var chunks = [];
    res.on("data", function (c) { chunks.push(c); });
    res.on("end", function () {
      var text = Buffer.concat(chunks).toString();
      var json = null;
      try { json = JSON.parse(text); } catch (e) { /* html response */ }
      cb(null, res.statusCode, json, text);
    });
  });
  req.on("error", cb);
  if (body) req.write(JSON.stringify(body));
  req.end();
}

// We need to set FIFO_PATH to /dev/null so writes don't block
process.env.DISPATCHER_FIFO = "/dev/null";

serverModule.server.listen(TEST_PORT, function () {
  console.log("  Test server on port " + TEST_PORT);

  // Test 1: GET /health
  request("GET", "/health", null, function (err, status, json) {
    assert.ifError(err);
    assert.strictEqual(status, 200);
    assert.strictEqual(json.status, "ok");
    assert.strictEqual(json.service, "dispatcher-brain");
    assert.ok(json.tasks);
    console.log("  PASS: GET /health returns ok with task counts");

    // Test 2: POST /api/submit
    request("POST", "/api/submit", { task: "run all tests" }, function (err, status, json) {
      assert.ifError(err);
      assert.strictEqual(status, 202);
      assert.strictEqual(json.accepted, true);
      assert.strictEqual(json.task.text, "run all tests");
      assert.strictEqual(json.task.status, "pending");
      var taskId = json.task.id;
      console.log("  PASS: POST /api/submit accepts task");

      // Test 3: GET /api/task/:id
      request("GET", "/api/task/" + taskId, null, function (err, status, json) {
        assert.ifError(err);
        assert.strictEqual(status, 200);
        assert.strictEqual(json.id, taskId);
        assert.strictEqual(json.text, "run all tests");
        console.log("  PASS: GET /api/task/:id returns task");

        // Test 4: POST /api/submit with missing field
        request("POST", "/api/submit", { wrong: "field" }, function (err, status, json) {
          assert.ifError(err);
          assert.strictEqual(status, 400);
          assert.ok(json.error);
          console.log("  PASS: POST /api/submit rejects missing task field");

          // Test 5: POST /api/a2a
          request("POST", "/api/a2a", { message: "deploy v2", agent_id: "worker-3" }, function (err, status, json) {
            assert.ifError(err);
            assert.strictEqual(status, 202);
            assert.strictEqual(json.accepted, true);
            assert.ok(json.task.source.indexOf("a2a:worker-3") !== -1);
            console.log("  PASS: POST /api/a2a accepts agent message");

            // Test 6: POST /api/a2a with missing message
            request("POST", "/api/a2a", { agent_id: "x" }, function (err, status, json) {
              assert.ifError(err);
              assert.strictEqual(status, 400);
              console.log("  PASS: POST /api/a2a rejects missing message");

              // Test 7: GET / returns HTML dashboard
              request("GET", "/", null, function (err, status, json, text) {
                assert.ifError(err);
                assert.strictEqual(status, 200);
                assert.ok(text.indexOf("Dispatcher Brain") !== -1, "dashboard has title");
                assert.ok(text.indexOf("Submit Task") !== -1, "dashboard has submit form");
                assert.ok(text.indexOf("/api/submit") !== -1, "dashboard has submit endpoint in JS");
                console.log("  PASS: GET / returns dashboard HTML with submit form");

                // Test 8: GET /submit also returns dashboard
                request("GET", "/submit", null, function (err, status, json, text) {
                  assert.ifError(err);
                  assert.strictEqual(status, 200);
                  assert.ok(text.indexOf("Dispatcher Brain") !== -1);
                  console.log("  PASS: GET /submit returns dashboard");

                  // Test 9: POST /api/complete
                  serverState.startTask(taskId);
                  request("POST", "/api/complete", { id: taskId, result: "tests passed" }, function (err, status, json) {
                    assert.ifError(err);
                    assert.strictEqual(status, 200);
                    assert.strictEqual(json.updated, true);
                    assert.strictEqual(json.task.status, "completed");
                    console.log("  PASS: POST /api/complete marks task done");

                    // Test 10: 404 for unknown routes
                    request("GET", "/nope", null, function (err, status, json) {
                      assert.ifError(err);
                      assert.strictEqual(status, 404);
                      console.log("  PASS: unknown routes return 404");

                      // Test 11: GET /api/task/:id for non-existent task
                      request("GET", "/api/task/nonexistent", null, function (err, status, json) {
                        assert.ifError(err);
                        assert.strictEqual(status, 404);
                        assert.ok(json.error);
                        console.log("  PASS: GET /api/task/:id returns 404 for unknown task");

                        // Test 12: task in history is findable
                        request("GET", "/api/task/" + taskId, null, function (err, status, json) {
                          assert.ifError(err);
                          assert.strictEqual(status, 200);
                          assert.strictEqual(json.status, "completed");
                          console.log("  PASS: completed task found in history");

                          serverModule.server.close(function () {
                            console.log("\nAll dispatcher-brain tests passed.");
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
