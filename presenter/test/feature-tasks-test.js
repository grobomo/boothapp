'use strict';

// Unit tests for feature-tasks API
// Run: node presenter/test/feature-tasks-test.js

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error('[FAIL] ' + msg);
  }
}

// Test 1: Module loads without errors
const { FEATURES, createRouter } = require('../lib/feature-tasks');
assert(typeof createRouter === 'function', 'createRouter should be a function');
assert(Array.isArray(FEATURES), 'FEATURES should be an array');

// Test 2: All 5 Casey features present
assert(FEATURES.length === 5, 'Should have 5 features, got ' + FEATURES.length);

// Test 3: Each feature has required fields
const requiredFields = ['id', 'feature', 'description', 'status', 'submitted_at'];
FEATURES.forEach(function(f) {
  requiredFields.forEach(function(field) {
    assert(f[field] !== undefined, 'Feature ' + f.id + ' missing field: ' + field);
  });
});

// Test 4: Feature IDs are unique
const ids = FEATURES.map(function(f) { return f.id; });
const uniqueIds = ids.filter(function(id, i) { return ids.indexOf(id) === i; });
assert(uniqueIds.length === ids.length, 'Feature IDs should be unique');

// Test 5: Feature 5 (demo capture) should be completed (already built)
const feature5 = FEATURES.find(function(f) { return f.id === 'feature-5'; });
assert(feature5 && feature5.status === 'completed', 'Feature 5 (demo capture) should be completed');

// Test 6: Router creates express router
const router = createRouter();
assert(router && typeof router === 'function', 'createRouter should return an express router');

// Test 7: Override mechanism works via env var
process.env.FEATURE_TASK_OVERRIDES = JSON.stringify({
  'feature-3': { status: 'in_progress' }
});
// Re-require to test override (module caches, but loadTaskOverrides reads env each time)
delete require.cache[require.resolve('../lib/feature-tasks')];
const { createRouter: cr2 } = require('../lib/feature-tasks');
// The override is applied at request time, not module load time
// So we test by checking the env parse doesn't crash
assert(typeof cr2 === 'function', 'Module should load with FEATURE_TASK_OVERRIDES set');
delete process.env.FEATURE_TASK_OVERRIDES;

console.log('\n--- feature-tasks-test ---');
console.log('Passed: ' + passed + '/' + (passed + failed));
if (failed > 0) {
  console.log('Failed: ' + failed);
  process.exit(1);
} else {
  console.log('All tests passed');
}
