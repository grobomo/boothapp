'use strict';

var assert = require('assert');
var tune = require('../tune-calc');

var DEFAULT_RATIOS = {
  workers_per_pending_task: 2,
  min_workers: 10,
  workers_per_monitor: 20,
  min_monitors: 1,
  dispatchers: 1,
};
var DEFAULT_THRESHOLDS = { drift_percent: 20, critical_percent: 50 };
var DEFAULT_CONFIG = { ratios: DEFAULT_RATIOS, thresholds: DEFAULT_THRESHOLDS };

// ---------------------------------------------------------------------------
// calcDesired
// ---------------------------------------------------------------------------
console.log('--- calcDesired ---');

{
  var r = tune.calcDesired(0, DEFAULT_RATIOS);
  assert.strictEqual(r.workers, 10, 'zero pending -> min_workers');
  assert.strictEqual(r.monitors, 1, 'zero pending -> min_monitors');
  assert.strictEqual(r.dispatchers, 1);
  console.log('  PASS: zero pending tasks uses minimums');
}

{
  var r = tune.calcDesired(25, DEFAULT_RATIOS);
  assert.strictEqual(r.workers, 50, '25 pending * 2 = 50');
  assert.strictEqual(r.monitors, 3, 'ceil(50/20) = 3');
  assert.strictEqual(r.dispatchers, 1);
  console.log('  PASS: 25 pending tasks -> 50 workers, 3 monitors');
}

{
  var r = tune.calcDesired(3, DEFAULT_RATIOS);
  assert.strictEqual(r.workers, 10, '3*2=6 < 10 -> min_workers');
  assert.strictEqual(r.monitors, 1, 'ceil(10/20)=1');
  console.log('  PASS: low pending uses min_workers');
}

{
  var r = tune.calcDesired(100, DEFAULT_RATIOS);
  assert.strictEqual(r.workers, 200, '100*2=200');
  assert.strictEqual(r.monitors, 10, 'ceil(200/20)=10');
  console.log('  PASS: 100 pending -> 200 workers, 10 monitors');
}

// ---------------------------------------------------------------------------
// statusColor
// ---------------------------------------------------------------------------
console.log('--- statusColor ---');

{
  var s = tune.statusColor(10, 10, DEFAULT_THRESHOLDS);
  assert.strictEqual(s.color, 'green');
  assert.strictEqual(s.status, 'MATCHED');
  console.log('  PASS: exact match -> green/MATCHED');
}

{
  var s = tune.statusColor(10, 11, DEFAULT_THRESHOLDS);
  assert.strictEqual(s.color, 'green');
  assert.strictEqual(s.status, 'MINOR');
  console.log('  PASS: 10% drift -> green/MINOR');
}

{
  var s = tune.statusColor(10, 13, DEFAULT_THRESHOLDS);
  assert.strictEqual(s.color, 'yellow');
  assert.strictEqual(s.status, 'DRIFT');
  console.log('  PASS: 30% drift -> yellow/DRIFT');
}

{
  var s = tune.statusColor(10, 16, DEFAULT_THRESHOLDS);
  assert.strictEqual(s.color, 'red');
  assert.strictEqual(s.status, 'CRITICAL');
  console.log('  PASS: 60% drift -> red/CRITICAL');
}

{
  var s = tune.statusColor(0, 5, DEFAULT_THRESHOLDS);
  assert.strictEqual(s.color, 'red');
  assert.strictEqual(s.status, 'CRITICAL');
  console.log('  PASS: actual=0 -> 100% drift -> red/CRITICAL');
}

// ---------------------------------------------------------------------------
// actionText
// ---------------------------------------------------------------------------
console.log('--- actionText ---');

{
  assert.strictEqual(tune.actionText(5, 10, 'worker'), 'add 5 worker(s)');
  console.log('  PASS: add workers');
}

{
  assert.strictEqual(tune.actionText(10, 5, 'monitor'), 'remove 5 monitor(s)');
  console.log('  PASS: remove monitors');
}

{
  assert.strictEqual(tune.actionText(10, 10, 'dispatcher'), 'none');
  console.log('  PASS: matched -> none');
}

// ---------------------------------------------------------------------------
// buildTuneData
// ---------------------------------------------------------------------------
console.log('--- buildTuneData ---');

{
  var health = { pending_tasks: 25, nodes: { workers: 8, monitors: 1, dispatchers: 1 } };
  var d = tune.buildTuneData(health, DEFAULT_CONFIG);
  assert.strictEqual(d.pending_tasks, 25);
  assert.strictEqual(d.roles.length, 3);
  assert.strictEqual(d.roles[0].role, 'workers');
  assert.strictEqual(d.roles[0].actual, 8);
  assert.strictEqual(d.roles[0].desired, 50);
  assert.strictEqual(d.roles[0].color, 'red');
  assert.strictEqual(d.roles[1].role, 'monitors');
  assert.strictEqual(d.roles[1].desired, 3);
  assert.strictEqual(d.roles[2].role, 'dispatchers');
  assert.strictEqual(d.roles[2].status, 'MATCHED');
  console.log('  PASS: full buildTuneData with nested nodes');
}

{
  var health = { pending_tasks: 5, workers: 10, monitors: 1, dispatchers: 1 };
  var d = tune.buildTuneData(health, DEFAULT_CONFIG);
  assert.strictEqual(d.roles[0].actual, 10);
  assert.strictEqual(d.roles[0].desired, 10);
  assert.strictEqual(d.roles[0].status, 'MATCHED');
  console.log('  PASS: flat health format works');
}

{
  var health = { queue: { pending: 10 }, nodes: { workers: 20, monitors: 1, dispatchers: 1 } };
  var d = tune.buildTuneData(health, DEFAULT_CONFIG);
  assert.strictEqual(d.pending_tasks, 10);
  assert.strictEqual(d.roles[0].desired, 20);
  console.log('  PASS: queue.pending format works');
}

console.log('\nAll tests passed.');
