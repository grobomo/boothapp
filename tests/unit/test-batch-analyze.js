#!/usr/bin/env node
// Unit tests for analysis/batch-analyze.js
// Runs the --sample mode and verifies output file and content

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', 'analysis', 'batch-analyze.js');
const OUTPUT = path.join(__dirname, '..', '..', 'presenter', 'batch-report.html');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${msg}`);
    failed++;
  }
}

// Clean up previous output
if (fs.existsSync(OUTPUT)) fs.unlinkSync(OUTPUT);

console.log('=== batch-analyze.js unit tests ===\n');

// Test 1: --sample mode produces output
console.log('-- Test: --sample mode');
const result = execFileSync('node', [SCRIPT, '--sample'], { encoding: 'utf8', timeout: 10000 });
assert(result.includes('5 sessions'), 'Reports 5 sessions');
assert(result.includes('Report written to'), 'Reports output path');
assert(fs.existsSync(OUTPUT), 'Output file exists');

// Test 2: HTML structure
console.log('-- Test: HTML structure');
const html = fs.readFileSync(OUTPUT, 'utf8');
assert(html.startsWith('<!DOCTYPE html>'), 'Starts with DOCTYPE');
assert(html.includes('</html>'), 'Ends with closing html tag');
assert(html.includes('<title>BoothApp'), 'Has title');
assert(html.includes('Batch Session Analysis'), 'Has report heading');

// Test 3: KPI cards present
console.log('-- Test: KPI cards');
assert(html.includes('class="kpi-value">5</div>'), 'Shows 5 sessions KPI');
assert(html.includes('Avg Duration'), 'Has avg duration KPI');
assert(html.includes('Avg Clicks/Session'), 'Has avg clicks KPI');

// Test 4: CSS-only charts
console.log('-- Test: CSS charts');
assert(html.includes('bar-fill'), 'Has bar chart fills');
assert(html.includes('conic-gradient'), 'Has donut chart');
assert(!html.includes('chart.js'), 'No external chart library');
assert(!html.includes('<canvas'), 'No canvas elements (CSS-only)');
assert(!html.includes('<script'), 'No JavaScript in output');

// Test 5: Module popularity section
console.log('-- Test: Module popularity');
assert(html.includes('V1 Module Popularity'), 'Has module popularity heading');
assert(html.includes('Endpoint Security'), 'Contains Endpoint Security module');
assert(html.includes('XDR'), 'Contains XDR module');

// Test 6: Questions section
console.log('-- Test: Visitor questions');
assert(html.includes('Common Visitor Questions'), 'Has questions heading');
assert(html.includes('question-card'), 'Has question cards');

// Test 7: Recommendations section
console.log('-- Test: Recommendations');
assert(html.includes('Demo Script Optimization'), 'Has recommendations heading');
assert(html.includes('rec-card'), 'Has recommendation cards');
assert(html.includes('Demo Flow') || html.includes('Preparation') || html.includes('Efficiency'), 'Has recommendation categories');

// Test 8: Session comparison table
console.log('-- Test: Session table');
assert(html.includes('Session Comparison'), 'Has comparison heading');
assert(html.includes('BATCH001'), 'Has first session ID');
assert(html.includes('BATCH005'), 'Has last session ID');
assert(html.includes('module-tag'), 'Has module tags in table');

// Test 9: Engagement by company size
console.log('-- Test: Engagement analysis');
assert(html.includes('Engagement by Company Size'), 'Has engagement heading');
assert(html.includes('Mid-Market'), 'Detects mid-market size');
assert(html.includes('Enterprise'), 'Detects enterprise size');

// Test 10: Responsive design
console.log('-- Test: Responsive design');
assert(html.includes('@media (max-width: 768px)'), 'Has mobile media query');

// Test 11: No arguments shows usage
console.log('-- Test: Usage message');
try {
  execFileSync('node', [SCRIPT], { encoding: 'utf8', timeout: 5000 });
  assert(false, 'Should exit with error');
} catch (err) {
  assert(err.stderr.includes('Usage:'), 'Shows usage on no args');
}

// Test 12: Invalid directory is skipped gracefully
console.log('-- Test: Invalid directory handling');
try {
  execFileSync('node', [SCRIPT, '/nonexistent/path'], { encoding: 'utf8', timeout: 5000 });
  assert(false, 'Should exit with error for no valid sessions');
} catch (err) {
  assert(err.stderr.includes('No valid sessions'), 'Reports no valid sessions');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
